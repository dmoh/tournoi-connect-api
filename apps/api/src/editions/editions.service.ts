import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../common/clock.js';
import {
  addDays,
  nextEditionDate,
  parisDate,
  parisTime,
} from '../common/paris-time.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { TournamentFormat } from '../generated/prisma/enums.js';
import { Mailer } from '../mail/mailer.js';
import { editionInviteMail } from '../mail/templates.js';
import type { NextEdition } from '../organizer/organizer.schemas.js';
import type { EditionOptOut } from './editions.schemas.js';
import { EDITION_QUEUE } from '../queue/queue.module.js';

/** « lundi 8 novembre 2027 » : envoyé un an à l'avance, l'année compte. */
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
});

/** Sans date de clôture connue : une semaine avant le tournoi. */
const DEFAULT_DEADLINE_DAYS = 7;

const FORMATS: Record<TournamentFormat, NextEdition['draft']['format']> = {
  SINGLE_GROUP: 'single-group',
  GROUPS_KNOCKOUT: 'groups-knockout',
  KNOCKOUT: 'knockout',
  SWISS: 'swiss',
};

export interface EditionInvitesJob {
  tournamentId: string;
}

/** « Tournoi de la Toussaint 2026 » → « … 2027 » ; un nom sans année reste tel quel. */
export function nextEditionName(name: string): string {
  return name.replace(/\b(20\d{2})\b/g, (year) => String(Number(year) + 1));
}

/**
 * Édition suivante d'un tournoi : un brouillon complet de l'assistant (le
 * club n'a qu'à publier), et l'invitation des responsables d'équipe de
 * l'édition précédente, une seule fois, par le worker.
 */
@Injectable()
export class EditionsService {
  private readonly logger = new Logger('Éditions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @InjectQueue(EDITION_QUEUE)
    private readonly queue?: Queue<EditionInvitesJob>,
  ) {}

  /** Brouillon de l'édition suivante d'un tournoi du club ; ailleurs : 404. */
  async nextEdition(
    organizationSlug: string,
    slug: string,
  ): Promise<NextEdition> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
      include: {
        venue: true,
        nextEditions: {
          orderBy: { startsAt: 'desc' },
          select: { slug: true, name: true, editionInvitesSentAt: true },
        },
      },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const startDay = parisDate(t.startsAt);
    const date = nextEditionDate(startDay);
    const shift =
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) /
      86_400_000;
    const deadline = t.registrationDeadline
      ? addDays(t.registrationDeadline.toISOString().slice(0, 10), shift)
      : addDays(date, -DEFAULT_DEADLINE_DAYS);
    return {
      draft: {
        name: nextEditionName(t.name),
        sport: t.sport,
        date,
        startTime: parisTime(t.startsAt),
        endTime: parisTime(t.endsAt),
        venueName: t.venue.name,
        city: t.venue.city,
        lat: t.venue.lat,
        lng: t.venue.lng,
        fields: t.fieldCount,
        outdoor: t.venue.outdoor,
        categories: t.categories,
        maxTeams: t.maxTeams,
        feeEuros: t.feeCents / 100,
        // La clôture ne peut suivre le tournoi (fin de mois décalée, par exemple).
        registrationDeadline: deadline <= date ? deadline : date,
        format: FORMATS[t.format],
        matchMinutes: t.matchMinutes,
        breakMinutes: t.breakMinutes,
        ...(t.rankingRules
          ? { rules: t.rankingRules as NextEdition['draft']['rules'] }
          : {}),
      },
      previous: {
        slug: t.slug,
        name: t.name,
        startsAt: t.startsAt.toISOString(),
        teams: (await this.recipients(t.id, t.organizationId)).length,
        // Une autre édition a déjà écrit aux équipes : on ne les relance pas.
        invited: t.nextEditions.some((e) => e.editionInvitesSentAt !== null),
      },
      existing: t.nextEditions[0]
        ? { slug: t.nextEditions[0].slug, name: t.nextEditions[0].name }
        : null,
    };
  }

  /** Dépose l'invitation dans la file du worker ; sans Redis, l'envoie tout de suite. */
  async enqueueInvites(tournamentId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        'invite-teams',
        { tournamentId },
        { jobId: `edition-invites-${tournamentId}` },
      );
      return;
    }
    try {
      await this.inviteTeams(tournamentId);
    } catch (error) {
      this.logger.error(
        `Invitations de l'édition ${tournamentId} : ${String(error)}`,
      );
    }
  }

  /**
   * Invite les responsables d'équipe de l'édition précédente, une seule fois
   * par édition (et une seule édition invite pour un même tournoi), tant que
   * les inscriptions sont ouvertes.
   */
  async inviteTeams(tournamentId: string): Promise<number> {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        venue: true,
        organization: { select: { name: true } },
        previousEdition: {
          select: {
            id: true,
            name: true,
            status: true,
            nextEditions: {
              where: { editionInvitesSentAt: { not: null } },
              select: { id: true },
            },
          },
        },
      },
    });
    if (
      !t?.previousEdition ||
      t.editionInvitesSentAt ||
      t.status !== 'REGISTRATION_OPEN' ||
      t.previousEdition.nextEditions.some((e) => e.id !== t.id)
    ) {
      return 0;
    }
    // Réservé avant l'envoi : un second passage (relance du job) n'envoie rien.
    const { count } = await this.prisma.tournament.updateMany({
      where: { id: t.id, editionInvitesSentAt: null },
      data: { editionInvitesSentAt: this.clock.now() },
    });
    if (count === 0) {
      return 0;
    }
    const recipients = await this.recipients(
      t.previousEdition.id,
      t.organizationId,
    );
    // Une invitation par adresse, avec son jeton de désinscription.
    await this.prisma.editionInvite.createMany({
      data: recipients.map((email) => ({
        organizationId: t.organizationId,
        tournamentId: t.id,
        email,
      })),
      skipDuplicates: true,
    });
    const invites = await this.prisma.editionInvite.findMany({
      where: { tournamentId: t.id, email: { in: recipients } },
      select: { email: true, token: true },
    });
    const joinUrl = this.appUrl(`/join/${encodeURIComponent(t.slug)}`);
    for (const invite of invites) {
      await this.mailer.send(
        editionInviteMail(invite.email, {
          tournament: t.name,
          previous: t.previousEdition.name,
          club: t.organization.name,
          date: DATE_FORMAT.format(t.startsAt),
          venue: `${t.venue.name}, ${t.venue.city}`,
          deadline: t.registrationDeadline
            ? DATE_FORMAT.format(t.registrationDeadline)
            : null,
          fee:
            t.feeCents > 0
              ? `${EUROS.format(t.feeCents / 100)} par équipe`
              : 'Inscription gratuite',
          joinUrl,
          unsubscribeUrl: this.appUrl(
            `/editions/desinscription/${invite.token}`,
          ),
          oneClickUrl: this.appUrl(
            `/api/v1/public/edition-invites/${invite.token}/opt-out`,
          ),
        }),
      );
    }
    this.logger.log(
      `Édition ${t.slug} : ${recipients.length} équipe(s) de l'édition précédente invitée(s).`,
    );
    return invites.length;
  }

  /** Invitation d'un lien de désinscription ; inconnue : 404. */
  async optOutInfo(token: string): Promise<EditionOptOut> {
    const invite = await this.prisma.editionInvite.findUnique({
      where: { token },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!invite) {
      throw new NotFoundException('Lien de désinscription inconnu.');
    }
    const optedOut = await this.prisma.editionInvite.count({
      where: {
        organizationId: invite.organizationId,
        email: invite.email,
        optedOutAt: { not: null },
      },
    });
    return { club: invite.organization.name, optedOut: optedOut > 0 };
  }

  /** Désinscription (lien de l'email, ou un clic du client mail) : rejouer ne change rien. */
  async optOut(token: string): Promise<EditionOptOut> {
    const invite = await this.prisma.editionInvite.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!invite) {
      throw new NotFoundException('Lien de désinscription inconnu.');
    }
    await this.prisma.editionInvite.updateMany({
      where: { id: invite.id, optedOutAt: null },
      data: { optedOutAt: this.clock.now() },
    });
    return this.optOutInfo(token);
  }

  /**
   * Adresses distinctes des responsables d'équipe inscrites à un tournoi
   * (confirmées ; pour un tournoi annulé, celles que l'annulation a rendues),
   * sans celles qui se sont désinscrites des invitations du club.
   */
  private async recipients(
    tournamentId: string,
    organizationId: string,
  ): Promise<string[]> {
    const [rows, optedOut] = await Promise.all([
      this.prisma.registration.findMany({
        where: {
          tournamentId,
          manager: { isNot: null },
          OR: [
            { status: 'CONFIRMED' },
            { status: 'CANCELLED', cancellation: 'TOURNAMENT_CANCELLED' },
          ],
        },
        select: { manager: { select: { email: true } } },
      }),
      this.prisma.editionInvite.findMany({
        where: { organizationId, optedOutAt: { not: null } },
        select: { email: true },
      }),
    ]);
    const excluded = new Set(optedOut.map((o) => o.email));
    return [
      ...new Set(
        rows.flatMap((r) => (r.manager ? [r.manager.email.toLowerCase()] : [])),
      ),
    ].filter((email) => !excluded.has(email));
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
