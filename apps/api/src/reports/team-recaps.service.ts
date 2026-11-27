import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Podium } from '@dmoh/tournoi-connect-engine';
import { Clock } from '../common/clock.js';
import { parisHour } from '../common/paris-time.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import { teamRecapMail, type RecapMatch } from '../mail/templates.js';
import { podiumOf } from '../palmares/palmares.service.js';
import {
  DATE_FORMAT,
  REPORT_AFTER_HOURS,
  REPORT_WITHIN_DAYS,
  SEND_FROM_HOUR,
  SEND_UNTIL_HOUR,
} from './sponsor-reports.service.js';

const HOUR = 60 * 60_000;
/** Tournois cherchés par lots. */
const BATCH = 50;

type Loaded = Prisma.TournamentGetPayload<{
  include: {
    teams: true;
    matches: true;
    organization: { select: { name: true } };
  };
}>;
type Recipient = Prisma.RegistrationGetPayload<{
  include: { manager: true; team: true };
}>;

/** « Poule A », « Quart de finale »… */
const PHASE_LABEL: Record<string, string> = {
  round_of_32: 'Seizième de finale',
  round_of_16: 'Huitième de finale',
  quarter: 'Quart de finale',
  semi: 'Demi-finale',
  third_place: 'Petite finale',
  final: 'Finale',
};

/**
 * Récapitulatif des équipes : le lendemain d'un tournoi terminé, chaque
 * responsable d'équipe reçoit ses résultats, le podium et les liens du
 * palmarès et des photos, une seule fois. Rien à faire pour le club ; un
 * responsable désinscrit des sollicitations du club n'est pas écrit.
 */
@Injectable()
export class TeamRecapsService {
  private readonly logger = new Logger('Récapitulatifs équipes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Balayage horaire (avec les bilans des partenaires) : les tournois
   * terminés depuis 12 h à 7 jours, de 8 h à 20 h (heure de Paris). Un échec
   * fait échouer le travail : la relance reprend ce qui manque.
   */
  async sweep(): Promise<number> {
    const nowDate = this.clock.now();
    const hour = parisHour(nowDate);
    if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) {
      return 0;
    }
    const now = nowDate.getTime();
    let sent = 0;
    let failed = 0;
    let cursor: string | undefined;
    for (;;) {
      const due = await this.prisma.tournament.findMany({
        where: {
          status: 'COMPLETED',
          teamRecapsSentAt: null,
          endsAt: {
            lte: new Date(now - REPORT_AFTER_HOURS * HOUR),
            gte: new Date(now - REPORT_WITHIN_DAYS * 24 * HOUR),
          },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      for (const { id } of due) {
        try {
          sent += await this.sendAll(id);
        } catch (error) {
          failed += 1;
          this.logger.error(`Tournoi ${id} : ${String(error)}`);
        }
      }
      if (due.length < BATCH) {
        break;
      }
      cursor = due[due.length - 1]!.id;
    }
    if (sent > 0) {
      this.logger.log(`${sent} récapitulatif(s) d'équipe envoyé(s).`);
    }
    if (failed > 0) {
      throw new Error(`${failed} tournoi(s) à relancer.`);
    }
    return sent;
  }

  /** Les récapitulatifs d'un tournoi ; le tournoi est marqué quand tous sont partis. */
  async sendAll(tournamentId: string): Promise<number> {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        teams: true,
        matches: { orderBy: { startsAt: 'asc' } },
        organization: { select: { name: true } },
      },
    });
    if (!t || t.teamRecapsSentAt) {
      return 0;
    }
    const recipients = await this.prisma.registration.findMany({
      where: {
        tournamentId,
        status: 'CONFIRMED',
        recapSentAt: null,
        teamId: { not: null },
        managerId: { not: null },
      },
      include: { manager: true, team: true },
      orderBy: { id: 'asc' },
    });
    const podium = podiumOf(t);
    const photos = await this.prisma.photo.count({
      where: { tournamentId, status: 'READY', hiddenAt: null },
    });
    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      try {
        sent += (await this.send(t, r, podium, photos)) ? 1 : 0;
      } catch (error) {
        failed += 1;
        this.logger.error(`Inscription ${r.id} : ${String(error)}`);
      }
    }
    if (failed > 0) {
      throw new Error(`${failed} récapitulatif(s) non envoyé(s).`);
    }
    await this.prisma.tournament.updateMany({
      where: { id: tournamentId, teamRecapsSentAt: null },
      data: { teamRecapsSentAt: this.clock.now() },
    });
    return sent;
  }

  /**
   * Un récapitulatif : préparé, puis réservé (un second passage n'envoie
   * rien) ; un envoi en échec rend la réservation, pour la relance.
   */
  private async send(
    t: Loaded,
    r: Recipient,
    podium: Podium | null,
    photos: number,
  ): Promise<boolean> {
    const email = r.manager?.email.toLowerCase();
    const team = r.team;
    if (!email || !team) {
      return false;
    }
    // Désinscrit des sollicitations du club : marqué, jamais écrit.
    const optedOut = await this.prisma.editionInvite.count({
      where: {
        organizationId: t.organizationId,
        email,
        optedOutAt: { not: null },
      },
    });
    if (optedOut > 0) {
      await this.prisma.registration.updateMany({
        where: { id: r.id, recapSentAt: null },
        data: { recapSentAt: this.clock.now() },
      });
      return false;
    }
    // Jeton de désinscription, le même que pour les invitations du club.
    await this.prisma.editionInvite.createMany({
      data: [{ organizationId: t.organizationId, tournamentId: t.id, email }],
      skipDuplicates: true,
    });
    const invite = await this.prisma.editionInvite.findUniqueOrThrow({
      where: { tournamentId_email: { tournamentId: t.id, email } },
      select: { token: true },
    });
    const name = (code: string | null | undefined) =>
      t.teams.find((x) => x.code === code)?.name ?? null;
    const message = teamRecapMail(email, {
      club: t.organization.name,
      tournament: t.name,
      date: DATE_FORMAT.format(t.startsAt),
      team: team.name,
      place:
        podium?.first === team.code
          ? 1
          : podium?.second === team.code
            ? 2
            : podium?.third.includes(team.code)
              ? 3
              : null,
      podium: podium
        ? {
            first: name(podium.first) ?? podium.first,
            second: name(podium.second),
            third: podium.third.map((code) => name(code) ?? code),
          }
        : null,
      matches: recapMatches(t, team.code),
      photos,
      palmaresUrl: this.appUrl(`/t/${t.slug}/palmares`),
      photosUrl: this.appUrl(`/t/${t.slug}/photos`),
      unsubscribeUrl: this.appUrl(`/editions/desinscription/${invite.token}`),
      oneClickUrl: this.appUrl(
        `/api/v1/public/edition-invites/${invite.token}/opt-out`,
      ),
    });
    const claimedAt = this.clock.now();
    const { count } = await this.prisma.registration.updateMany({
      where: { id: r.id, recapSentAt: null },
      data: { recapSentAt: claimedAt },
    });
    if (count === 0) {
      return false;
    }
    try {
      await this.mailer.send(message);
    } catch (error) {
      await this.prisma.registration.updateMany({
        where: { id: r.id, recapSentAt: claimedAt },
        data: { recapSentAt: null },
      });
      throw error;
    }
    return true;
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}

/** Les matchs joués par l'équipe, dans l'ordre, avec leur issue. */
export function recapMatches(t: Loaded, code: string): RecapMatch[] {
  return t.matches.flatMap((m): RecapMatch[] => {
    const home = m.homeTeamCode === code;
    if (m.status !== 'FINISHED' || (!home && m.awayTeamCode !== code)) {
      return [];
    }
    const side = home ? 'HOME' : 'AWAY';
    const opponentCode = home ? m.awayTeamCode : m.homeTeamCode;
    const scored = home ? m.scoreHome : m.scoreAway;
    const conceded = home ? m.scoreAway : m.scoreHome;
    const result = m.forfeit
      ? m.forfeit === side
        ? 'L'
        : 'W'
      : m.winnerSide
        ? m.winnerSide === side
          ? 'W'
          : 'L'
        : scored > conceded
          ? 'W'
          : scored < conceded
            ? 'L'
            : 'D';
    return [
      {
        stage:
          m.phase === 'groups'
            ? `Poule${m.group ? ` ${m.group}` : ''}`
            : m.phase === 'swiss'
              ? `Ronde${m.round ? ` ${m.round}` : ''}`
              : (PHASE_LABEL[m.phase] ?? m.phase),
        opponent:
          t.teams.find((x) => x.code === opponentCode)?.name ??
          opponentCode ??
          '?',
        scored,
        conceded,
        result,
        forfeit: m.forfeit !== null,
      },
    ];
  });
}
