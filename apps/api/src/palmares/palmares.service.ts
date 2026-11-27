import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  computeStandings,
  computeSwissStandings,
  podium,
  rulesFor,
  topScorers,
  type Podium,
} from '@dmoh/tournoi-connect-engine';
import { storedRules } from '../common/ranking-rules.schema.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PushService } from '../push/push.service.js';
import { FORMAT_KIND, PUBLIC_STATUSES } from '../public/public-mapping.js';
import type { Palmares } from './palmares.schemas.js';

type Loaded = Prisma.TournamentGetPayload<{
  include: { teams: true; matches: true };
}>;

/** Un tournoi qui se joue encore : le palmarès le fait passer « terminé ». */
const PLAYING = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
] as const;

/**
 * Palmarès d'un tournoi : podium calculé par le moteur dès que la finale (ou
 * le classement final) est jouée, meilleurs buteurs saisis par la table de
 * marque. À chaque fin de match, le tournoi passe « terminé » quand son
 * podium est connu (les suiveurs sont prévenus) et revient « en cours » si un
 * résultat décisif est annulé.
 */
@Injectable()
export class PalmaresService {
  private readonly logger = new Logger(PalmaresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async view(slug: string): Promise<Palmares> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      include: { teams: true, matches: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const result = podiumOf(tournament);
    return {
      complete: result !== null,
      podium: result,
      scorers: await this.scorers(tournament),
    };
  }

  /** Statut « terminé » selon le podium, après chaque fin de match. */
  async settle(tournamentId: string): Promise<void> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { teams: true, matches: true },
    });
    if (!tournament) {
      return;
    }
    const result = podiumOf(tournament);
    if (result && (PLAYING as readonly string[]).includes(tournament.status)) {
      const { count } = await this.prisma.tournament.updateMany({
        where: { id: tournament.id, status: { in: [...PLAYING] } },
        data: { status: 'COMPLETED' },
      });
      if (count > 0) {
        this.logger.log(`Tournoi ${tournament.slug} terminé.`);
        await this.announce(tournament, result).catch((error: unknown) =>
          this.logger.error(error),
        );
      }
    } else if (!result && tournament.status === 'COMPLETED') {
      // Résultat décisif annulé : le tournoi se joue de nouveau.
      await this.prisma.tournament.updateMany({
        where: { id: tournament.id, status: 'COMPLETED' },
        data: { status: 'IN_PROGRESS' },
      });
      this.logger.log(`Tournoi ${tournament.slug} de nouveau en cours.`);
    }
  }

  private async announce(tournament: Loaded, result: Podium): Promise<void> {
    const name = (code: string | null) =>
      tournament.teams.find((t) => t.code === code)?.name ?? '?';
    const deciding =
      tournament.matches.find((m) => m.phase === 'final') ??
      [...tournament.matches].sort(
        (a, b) => b.startsAt.getTime() - a.startsAt.getTime(),
      )[0]!;
    await this.push.notify({
      kind: 'result',
      tournamentSlug: tournament.slug,
      matchCode: deciding.code,
      homeTeam: deciding.homeTeamCode,
      awayTeam: deciding.awayTeamCode,
      title: `${name(result.first)} remporte le ${tournament.name} !`,
      body: [
        result.second ? `2e : ${name(result.second)}` : null,
        result.third.length > 0
          ? `3e : ${result.third.map(name).join(' et ')}`
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
      url: `/t/${tournament.slug}/palmares`,
      tag: `palmares-${tournament.slug}`,
      eventId: `palmares-${tournament.slug}-${result.first}`,
    });
  }

  private async scorers(tournament: Loaded): Promise<Palmares['scorers']> {
    const events = await this.prisma.matchEvent.findMany({
      where: {
        match: { tournamentId: tournament.id },
        type: { in: ['GOAL', 'CANCEL'] },
      },
      select: {
        id: true,
        type: true,
        side: true,
        player: true,
        cancelsId: true,
        matchId: true,
      },
    });
    const cancelled = new Set(
      events.filter((e) => e.type === 'CANCEL').map((e) => e.cancelsId),
    );
    const matches = new Map(tournament.matches.map((m) => [m.id, m]));
    const goals = events.flatMap((e) => {
      const match = matches.get(e.matchId);
      const team =
        e.side === 'HOME'
          ? match?.homeTeamCode
          : e.side === 'AWAY'
            ? match?.awayTeamCode
            : null;
      return e.type === 'GOAL' && !cancelled.has(e.id) && team
        ? [{ team, player: e.player }]
        : [];
    });
    return topScorers(goals).map((s) => ({
      teamId: s.team,
      player: s.player,
      goals: s.goals,
    }));
  }
}

/** Podium du tournoi d'après ses matchs et son classement final. */
export function podiumOf(t: Loaded): Podium | null {
  const format = FORMAT_KIND[t.format];
  const rules = rulesFor(t.sport, storedRules(t.rankingRules));
  const results = (phase: 'groups' | 'swiss') =>
    t.matches
      .filter((m) => m.phase === phase)
      .map((m) => ({
        homeTeamId: m.homeTeamCode,
        awayTeamId: m.awayTeamCode,
        scoreHome: m.scoreHome,
        scoreAway: m.scoreAway,
        finished: m.status === 'FINISHED',
      }));
  const ranking =
    format === 'swiss'
      ? computeSwissStandings(
          t.teams.map((team) => ({ id: team.code, name: team.name })),
          results('swiss'),
          t.teams.flatMap((team) => team.byeRounds.map(() => team.code)),
          rules,
        ).map((r) => r.teamId)
      : format === 'single-group'
        ? (computeStandings(
            t.teams.map((team) => ({
              id: team.code,
              name: team.name,
              group: team.group,
            })),
            results('groups'),
            rules,
          )[0]?.rows.map((r) => r.teamId) ?? [])
        : [];
  return podium({
    format,
    ranking,
    swissRounds: t.swissRounds,
    matches: t.matches.map((m) => ({
      code: m.code,
      phase: m.phase,
      round: m.round,
      homeTeam: m.homeTeamCode,
      awayTeam: m.awayTeamCode,
      scoreHome: m.scoreHome,
      scoreAway: m.scoreAway,
      finished: m.status === 'FINISHED',
      winnerSide:
        m.winnerSide === 'HOME'
          ? 'home'
          : m.winnerSide === 'AWAY'
            ? 'away'
            : null,
    })),
  });
}
