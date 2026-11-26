import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FORFEIT_SCORE } from '@dmoh/tournoi-connect-engine';
import { BracketService } from '../bracket/bracket.service.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Tournament } from '../generated/prisma/client.js';
import { PLAYABLE_STATUSES } from '../public/public-mapping.js';
import type { Arrival, ForfeitResult, Matchday } from './matchday.schemas.js';

const HOUR = 60 * 60_000;
/** Le signalement d'arrivée ouvre 4 h avant le début du tournoi. */
export const ARRIVAL_OPENS_HOURS = 4;
/** Jour J : de 4 h avant le début à la fin du tournoi, tournoi pas terminé. */
export function arrivalOpen(
  t: Pick<Tournament, 'startsAt' | 'endsAt' | 'status'>,
  now: Date,
): boolean {
  return (
    t.status !== 'COMPLETED' &&
    now.getTime() >= t.startsAt.getTime() - ARRIVAL_OPENS_HOURS * HOUR &&
    now <= t.endsAt
  );
}

/** Un forfait peut libérer des matchs du tableau : on suit la chaîne, sans boucle sans fin. */
const MAX_FORFEIT_ROUNDS = 10;

/**
 * Jour J : arrivée des équipes (un appui depuis la convocation ou Mes
 * équipes, ou pointée par le club) et forfaits. Une équipe forfait perd ses
 * matchs restants au score de forfait du sport ; le tableau et le palmarès
 * suivent, comme après une fin de match.
 */
@Injectable()
export class MatchdayService {
  private readonly logger = new Logger('Jour J');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly bracket: BracketService,
  ) {}

  /** Lien personnel d'une équipe inscrite ; inconnu ou hors d'usage : 404. */
  async arrival(token: string): Promise<Arrival> {
    const r = await this.registrationOf(token);
    return {
      team: r.team.name,
      tournament: {
        slug: r.tournament.slug,
        name: r.tournament.name,
        startsAt: r.tournament.startsAt.toISOString(),
        venue: `${r.tournament.venue.name}, ${r.tournament.venue.city}`,
      },
      arrivedAt: r.team.arrivedAt?.toISOString() ?? null,
      open: this.isOpen(r.tournament),
    };
  }

  /** « Nous sommes arrivés » : un appui, le jour J seulement ; rejouer ne change rien. */
  async arrive(token: string): Promise<Arrival> {
    const r = await this.registrationOf(token);
    if (!this.isOpen(r.tournament)) {
      throw new ConflictException(
        'Le signalement d’arrivée ouvre le jour du tournoi, 4 h avant le début.',
      );
    }
    await this.prisma.team.updateMany({
      where: { id: r.team.id, arrivedAt: null },
      data: { arrivedAt: this.clock.now() },
    });
    return this.arrival(token);
  }

  /** Équipes du tournoi pour la régie : arrivées, forfaits, prochain match. */
  async matchday(organizationSlug: string, slug: string): Promise<Matchday> {
    const t = await this.own(organizationSlug, slug);
    const [teams, matches] = await Promise.all([
      this.prisma.team.findMany({
        where: { tournamentId: t.id },
        orderBy: { name: 'asc' },
      }),
      this.prisma.match.findMany({
        where: { tournamentId: t.id },
        orderBy: { startsAt: 'asc' },
        select: {
          startsAt: true,
          status: true,
          forfeit: true,
          homeTeamCode: true,
          awayTeamCode: true,
        },
      }),
    ]);
    const rows = teams.map((team) => {
      const own = matches.filter(
        (m) => m.homeTeamCode === team.code || m.awayTeamCode === team.code,
      );
      // Une équipe qui a joué (ou joue) est là, même sans pointage.
      const played = own.find((m) => m.status !== 'SCHEDULED' && !m.forfeit);
      const arrivedAt = team.arrivedAt ?? played?.startsAt ?? null;
      return {
        code: team.code,
        name: team.name,
        arrivedAt: arrivedAt?.toISOString() ?? null,
        played: played !== undefined,
        forfeit: team.forfeitAt !== null,
        nextMatchAt:
          own.find((m) => m.status === 'SCHEDULED')?.startsAt.toISOString() ??
          null,
      };
    });
    return { teams: rows, arrived: rows.filter((r) => r.arrivedAt).length };
  }

  /** Pointage par le club (un appui), ou retrait d'un pointage fait par erreur. */
  async setArrival(
    organizationSlug: string,
    slug: string,
    code: string,
    arrived: boolean,
  ): Promise<Matchday> {
    const t = await this.own(organizationSlug, slug);
    const { count } = await this.prisma.team.updateMany({
      where: { tournamentId: t.id, code },
      data: { arrivedAt: arrived ? this.clock.now() : null },
    });
    if (count === 0) {
      throw new NotFoundException('Équipe introuvable.');
    }
    return this.matchday(organizationSlug, slug);
  }

  /**
   * Forfait : les matchs à venir de l'équipe (adversaire connu) sont gagnés
   * par l'adversaire au score de forfait du sport ; le tableau avance, et les
   * matchs qu'il remplit avec l'équipe forfait le sont aussi.
   */
  async forfeit(
    organizationSlug: string,
    slug: string,
    code: string,
  ): Promise<ForfeitResult> {
    const t = await this.own(organizationSlug, slug);
    if (!(PLAYABLE_STATUSES as readonly string[]).includes(t.status)) {
      throw new ConflictException(
        'Ce tournoi est terminé ou annulé : plus de forfait possible.',
      );
    }
    const { count } = await this.prisma.team.updateMany({
      where: { tournamentId: t.id, code, forfeitAt: null },
      data: { forfeitAt: this.clock.now() },
    });
    if (count === 0) {
      const exists = await this.prisma.team.count({
        where: { tournamentId: t.id, code },
      });
      throw exists
        ? new ConflictException('Cette équipe est déjà forfait.')
        : new NotFoundException('Équipe introuvable.');
    }
    let total = 0;
    for (let round = 0; round < MAX_FORFEIT_ROUNDS; round += 1) {
      const settled = await this.settleForfeits(t);
      // Fins de match : qualifiés et vainqueurs prennent leur place, palmarès à jour.
      await this.bracket.advance(t.id);
      total += settled;
      if (settled === 0) {
        break;
      }
    }
    this.logger.log(
      `Forfait de ${code} au tournoi ${slug} : ${total} match(s) attribué(s).`,
    );
    return { matches: total };
  }

  /** Matchs à venir d'une équipe forfait, adversaire connu : gagnés par l'adversaire. */
  private async settleForfeits(t: Tournament): Promise<number> {
    const forfeited = new Set(
      (
        await this.prisma.team.findMany({
          where: { tournamentId: t.id, forfeitAt: { not: null } },
          select: { code: true },
        })
      ).map((team) => team.code),
    );
    const pending = await this.prisma.match.findMany({
      where: {
        tournamentId: t.id,
        status: 'SCHEDULED',
        homeTeamCode: { not: null },
        awayTeamCode: { not: null },
      },
    });
    const score = FORFEIT_SCORE[t.sport];
    let settled = 0;
    for (const m of pending) {
      const homeOut = forfeited.has(m.homeTeamCode!);
      const awayOut = forfeited.has(m.awayTeamCode!);
      if (!homeOut && !awayOut) {
        continue;
      }
      // Deux équipes forfait : l'équipe à domicile est comptée forfait.
      const side = homeOut ? 'HOME' : 'AWAY';
      const { count } = await this.prisma.match.updateMany({
        where: { id: m.id, status: 'SCHEDULED' },
        data: {
          status: 'FINISHED',
          forfeit: side,
          scoreHome: side === 'HOME' ? 0 : score,
          scoreAway: side === 'HOME' ? score : 0,
          minute: null,
        },
      });
      settled += count;
    }
    return settled;
  }

  private async registrationOf(token: string) {
    const r = await this.prisma.registration.findUnique({
      where: { arrivalToken: token },
      include: { team: true, tournament: { include: { venue: true } } },
    });
    if (
      !r ||
      r.status !== 'CONFIRMED' ||
      !r.team ||
      r.tournament.hiddenAt !== null ||
      !(PLAYABLE_STATUSES as readonly string[]).includes(r.tournament.status)
    ) {
      throw new NotFoundException('Lien d’arrivée inconnu ou plus valable.');
    }
    return { ...r, team: r.team };
  }

  /** Jour J : de 4 h avant le début à la fin du tournoi, tournoi pas terminé. */
  private isOpen(
    t: Pick<Tournament, 'startsAt' | 'endsAt' | 'status'>,
  ): boolean {
    return arrivalOpen(t, this.clock.now());
  }

  private async own(organizationSlug: string, slug: string) {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    return t;
  }
}
