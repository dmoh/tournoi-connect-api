import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import { PUSH_QUEUE } from '../queue/queue.module.js';
import { isPushEndpoint } from './push-hosts.js';
import { PushSender, type PushOutcome } from './push-sender.js';
import type {
  Follows,
  MatchNotification,
  PushConfig,
  Subscribe,
} from './push.schemas.js';

const PREFERENCE = {
  kickoff: 'kickoff',
  goal: 'goals',
  result: 'results',
} as const;

/** Envois simultanés vers les services push, par tranche. */
export const PUSH_CONCURRENCY = 20;

/**
 * Suivis des comptes et notifications web push. Un appareil abonné reçoit
 * les matchs des tournois et équipes qu'il suit, plus ceux du compte
 * connecté ; un abonnement expiré chez le navigateur est supprimé.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger('Push');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: PushSender,
    private readonly clock: Clock,
    @Optional()
    @InjectQueue(PUSH_QUEUE)
    private readonly queue?: Queue<MatchNotification>,
  ) {}

  config(): PushConfig {
    return { publicKey: this.sender.publicKey };
  }

  async subscribe(input: Subscribe, userId: string | null): Promise<void> {
    if (!this.sender.publicKey) {
      throw new ServiceUnavailableException('Notifications non configurées.');
    }
    const data = {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      tournaments: unique(input.follows.tournaments),
      teams: unique(input.follows.teams),
      ...input.preferences,
      // Un appareil connecté est relié au compte ; déconnecté, il garde le dernier.
      ...(userId ? { userId } : {}),
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  async follows(userId: string): Promise<Follows> {
    const rows = await this.prisma.follow.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      tournaments: rows
        .filter((r) => r.kind === 'TOURNAMENT')
        .map((r) => r.target),
      teams: rows.filter((r) => r.kind === 'TEAM').map((r) => r.target),
    };
  }

  /** Remplace les suivis du compte (chaque suivi ou retrait sur un appareil). */
  async replaceFollows(userId: string, follows: Follows): Promise<Follows> {
    await this.prisma.$transaction([
      this.prisma.follow.deleteMany({ where: { userId } }),
      this.prisma.follow.createMany({
        data: rows(userId, follows),
        skipDuplicates: true,
      }),
    ]);
    return this.follows(userId);
  }

  /** Ajoute les suivis d'un appareil à ceux du compte (à la connexion). */
  async mergeFollows(userId: string, follows: Follows): Promise<Follows> {
    await this.prisma.follow.createMany({
      data: rows(userId, follows),
      skipDuplicates: true,
    });
    return this.follows(userId);
  }

  /** Dépose la notification pour le worker ; sans Redis, l'envoie tout de suite. */
  async notify(notification: MatchNotification): Promise<void> {
    if (!this.sender.publicKey) {
      return;
    }
    if (this.queue) {
      // Identifiant déterministe : un second dépôt du même événement est ignoré.
      await this.queue.add('match', notification, {
        jobId: notificationJobId(notification),
      });
    } else {
      await this.deliver(notification);
    }
  }

  /** Envoie la notification aux appareils qui suivent le tournoi ou l'une des équipes. */
  async deliver(
    notification: MatchNotification,
  ): Promise<{ sent: number; gone: number }> {
    const slug = notification.tournamentSlug;
    const teams = [notification.homeTeam, notification.awayTeam]
      .filter((code): code is string => code !== null)
      .map((code) => `${slug}/${code}`);
    const followers = await this.prisma.follow.findMany({
      where: {
        OR: [
          { kind: 'TOURNAMENT', target: slug },
          { kind: 'TEAM', target: { in: teams } },
        ],
      },
      select: { userId: true },
    });
    const preference = PREFERENCE[notification.kind];
    const targets = await this.prisma.pushSubscription.findMany({
      where: {
        [preference]: true,
        OR: [
          { tournaments: { has: slug } },
          { teams: { hasSome: teams } },
          { userId: { in: [...new Set(followers.map((f) => f.userId))] } },
        ],
      },
    });
    const payload = {
      notification: {
        title: notification.title,
        body: notification.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
        lang: 'fr',
        // Une notification par match : le score suivant remplace le précédent.
        tag: `match-${slug}-${notification.matchCode}`,
        renotify: true,
        data: {
          onActionClick: {
            default: {
              operation: 'navigateLastFocusedOrOpen',
              url: `/t/${slug}/m/${notification.matchCode}`,
            },
          },
        },
      },
    };
    // Adresses hors des services push connus (anciens abonnements) : jamais contactées.
    const reachable = targets.filter((t) => isPushEndpoint(t.endpoint));
    const goneIds = targets
      .filter((t) => !isPushEndpoint(t.endpoint))
      .map((t) => t.id);
    const sentIds: string[] = [];
    for (let start = 0; start < reachable.length; start += PUSH_CONCURRENCY) {
      const batch = reachable.slice(start, start + PUSH_CONCURRENCY);
      const outcomes = await Promise.allSettled(
        batch.map((target) => this.sender.send(target, payload)),
      );
      outcomes.forEach((result, index) => {
        const outcome: PushOutcome =
          result.status === 'fulfilled' ? result.value : 'failed';
        const id = batch[index]!.id;
        if (outcome === 'sent') {
          sentIds.push(id);
        } else if (outcome === 'gone') {
          goneIds.push(id);
        }
      });
    }
    // Les notifications sont parties : une erreur de suivi ne doit pas faire
    // relancer la tâche, qui les renverrait à tout le monde.
    try {
      if (sentIds.length > 0) {
        await this.prisma.pushSubscription.updateMany({
          where: { id: { in: sentIds } },
          data: { lastSentAt: this.clock.now() },
        });
      }
      if (goneIds.length > 0) {
        await this.prisma.pushSubscription.deleteMany({
          where: { id: { in: goneIds } },
        });
      }
    } catch (error) {
      this.logger.error(
        `Suivi des envois push non enregistré : ${(error as Error).message}`,
      );
    }
    return { sent: sentIds.length, gone: goneIds.length };
  }
}

const unique = (list: readonly string[]) => [...new Set(list)];

/**
 * Identifiant BullMQ de la notification (sans « : », interdit par BullMQ) :
 * l'événement source s'il est connu, sinon le contenu de la notification.
 */
export function notificationJobId(notification: MatchNotification): string {
  const source = notification.eventId ?? [
    notification.kind,
    notification.title,
    notification.body,
  ];
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        notification.tournamentSlug,
        notification.matchCode,
        source,
      ]),
    )
    .digest('base64url')
    .slice(0, 32);
  return `match-${digest}`;
}

function rows(userId: string, follows: Follows) {
  return [
    ...unique(follows.tournaments).map((target) => ({
      userId,
      kind: 'TOURNAMENT' as const,
      target,
    })),
    ...unique(follows.teams).map((target) => ({
      userId,
      kind: 'TEAM' as const,
      target,
    })),
  ];
}
