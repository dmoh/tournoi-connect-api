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
import { addDays, parisDate, parisTime } from '../common/paris-time.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { TournamentFormat } from '../generated/prisma/enums.js';
import { Mailer } from '../mail/mailer.js';
import { editionInviteMail } from '../mail/templates.js';
import type { NextEdition } from '../organizer/organizer.schemas.js';
import { EDITION_QUEUE } from '../queue/queue.module.js';
import { DAY_FORMAT } from '../registrations/registration-state.js';

/** Une édition par an, le même jour de la semaine : 52 semaines plus tard. */
export const EDITION_SHIFT_DAYS = 52 * 7;
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
      include: { venue: true },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const date = addDays(parisDate(t.startsAt), EDITION_SHIFT_DAYS);
    const deadline = t.registrationDeadline
      ? addDays(
          t.registrationDeadline.toISOString().slice(0, 10),
          EDITION_SHIFT_DAYS,
        )
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
        teams: (await this.recipients(t.id)).length,
      },
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
    const recipients = await this.recipients(t.previousEdition.id);
    const joinUrl = this.appUrl(`/join/${encodeURIComponent(t.slug)}`);
    for (const to of recipients) {
      await this.mailer.send(
        editionInviteMail(to, {
          tournament: t.name,
          previous: t.previousEdition.name,
          club: t.organization.name,
          date: DAY_FORMAT.format(t.startsAt),
          venue: `${t.venue.name}, ${t.venue.city}`,
          joinUrl,
        }),
      );
    }
    this.logger.log(
      `Édition ${t.slug} : ${recipients.length} équipe(s) de l'édition précédente invitée(s).`,
    );
    return recipients.length;
  }

  /** Adresses distinctes des responsables d'équipe confirmés d'un tournoi. */
  private async recipients(tournamentId: string): Promise<string[]> {
    const rows = await this.prisma.registration.findMany({
      where: { tournamentId, status: 'CONFIRMED', manager: { isNot: null } },
      select: { manager: { select: { email: true } } },
    });
    return [
      ...new Set(
        rows.flatMap((r) => (r.manager ? [r.manager.email.toLowerCase()] : [])),
      ),
    ];
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
