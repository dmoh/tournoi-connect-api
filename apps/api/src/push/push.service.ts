import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import { PUSH_QUEUE } from '../queue/queue.module.js';
import { PushSender } from './push-sender.js';
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

/**
 * Suivis des comptes et notifications web push. Un appareil abonné reçoit
 * les matchs des tournois et équipes qu'il suit, plus ceux du compte
 * connecté ; un abonnement expiré chez le navigateur est supprimé.
 */
@Injectable()
export class PushService {
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
      await this.queue.add('match', notification);
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
    let sent = 0;
    let gone = 0;
    for (const target of targets) {
      const outcome = await this.sender.send(target, payload);
      if (outcome === 'gone') {
        gone += 1;
        await this.prisma.pushSubscription.deleteMany({
          where: { id: target.id },
        });
      } else if (outcome === 'sent') {
        sent += 1;
        await this.prisma.pushSubscription.update({
          where: { id: target.id },
          data: { lastSentAt: this.clock.now() },
        });
      }
    }
    return { sent, gone };
  }
}

const unique = (list: readonly string[]) => [...new Set(list)];

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
