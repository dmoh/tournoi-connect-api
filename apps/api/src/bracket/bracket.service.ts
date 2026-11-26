import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  advanceBracket,
  computeStandings,
  drawTournament,
  pairSwissRound,
  rulesFor,
  scheduleMatches,
  sourceLabel,
  swissRoundCount,
  type FormatKind,
  type ScheduledMatch,
} from '@dmoh/tournoi-connect-engine';
import { randomBytes } from 'node:crypto';
import { storedRules } from '../common/ranking-rules.schema.js';
import { PrismaService } from '../database/prisma.service.js';
import { PalmaresService } from '../palmares/palmares.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { FORMAT_KIND } from '../public/public-mapping.js';
import type { DrawView, WinnerInput } from './bracket.schemas.js';

/**
 * Tirage des poules, calendrier des matchs et avancement du tableau final
 * (moteur du tournoi). Le tirage se refait tant qu'aucun match n'a commencé ;
 * ensuite, chaque fin de match place les qualifiés et les vainqueurs.
 */
@Injectable()
export class BracketService {
  private readonly logger = new Logger(BracketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly palmares: PalmaresService,
  ) {}

  async view(organizationSlug: string, slug: string): Promise<DrawView> {
    const tournament = await this.own(organizationSlug, slug);
    const [teams, matches] = await Promise.all([
      this.prisma.team.findMany({
        where: { tournamentId: tournament.id },
        orderBy: { name: 'asc' },
      }),
      this.prisma.match.findMany({
        where: { tournamentId: tournament.id },
        select: { status: true, startsAt: true, round: true },
      }),
    ]);
    const groups = [
      ...new Set(teams.map((t) => t.group).filter((g): g is string => !!g)),
    ].sort();
    const last = matches.reduce<Date | null>(
      (latest, m) => (!latest || m.startsAt > latest ? m.startsAt : latest),
      null,
    );
    const drawn = Math.max(0, ...matches.map((m) => m.round ?? 0));
    const swiss =
      tournament.format === 'SWISS' && tournament.swissRounds
        ? { rounds: tournament.swissRounds, drawn }
        : null;
    // Système suisse : les rondes pas encore appariées s'ajoutent à la fin.
    const remaining = swiss ? Math.max(0, swiss.rounds - drawn) : 0;
    const roundMs =
      Math.ceil(
        Math.floor(teams.length / 2) / Math.max(1, tournament.fieldCount),
      ) *
      (tournament.matchMinutes + tournament.breakMinutes) *
      60_000;
    const endsAt = last
      ? new Date(
          last.getTime() +
            tournament.matchMinutes * 60_000 +
            remaining * roundMs,
        )
      : null;
    return {
      format: FORMAT_KIND[tournament.format],
      teams: teams.map((t) => ({ code: t.code, name: t.name })),
      seed: tournament.drawSeed,
      started: matches.some((m) => m.status !== 'SCHEDULED'),
      groups: groups.map((group) => ({
        group,
        teams: teams
          .filter((t) => t.group === group)
          .map((t) => ({ code: t.code, name: t.name })),
      })),
      matches: matches.length,
      endsAt: endsAt?.toISOString() ?? null,
      swiss,
      overrunMinutes: endsAt
        ? Math.max(
            0,
            Math.ceil(
              (endsAt.getTime() - tournament.endsAt.getTime()) / 60_000,
            ),
          )
        : 0,
    };
  }

  /**
   * Tire les poules et génère le calendrier (remplace un tirage précédent).
   * Système suisse : seule la première ronde est tirée, les suivantes sont
   * appariées au fil des résultats. 409 si un match a commencé ou s'il
   * manque des équipes.
   */
  async draw(
    organizationSlug: string,
    slug: string,
    seed?: string,
  ): Promise<DrawView> {
    const tournament = await this.own(organizationSlug, slug);
    const used = seed ?? randomBytes(4).toString('hex');
    await this.prisma.$transaction(async (tx) => {
      const started = await tx.match.count({
        where: { tournamentId: tournament.id, status: { not: 'SCHEDULED' } },
      });
      if (started > 0) {
        throw new ConflictException(
          'Un match a commencé : le tirage ne peut plus être refait.',
        );
      }
      const teams = await tx.team.findMany({
        where: { tournamentId: tournament.id },
        select: { code: true },
      });
      if (teams.length < 2) {
        throw new ConflictException(
          'Il faut au moins deux équipes inscrites pour faire le tirage.',
        );
      }
      if (tournament.format === 'SWISS') {
        const first = pairSwissRound({
          teams: teams.map((t) => ({ id: t.code, name: t.code })),
          results: [],
          byes: [],
          round: 1,
          seed: used,
        });
        await tx.match.deleteMany({ where: { tournamentId: tournament.id } });
        await tx.team.updateMany({
          where: { tournamentId: tournament.id },
          data: { group: null, byeRounds: [] },
        });
        if (first.bye) {
          await tx.team.updateMany({
            where: { tournamentId: tournament.id, code: first.bye },
            data: { byeRounds: [1] },
          });
        }
        await tx.match.createMany({
          data: scheduleMatches(first.matches, {
            startsAt: tournament.startsAt.getTime(),
            fields: tournament.fieldCount,
            matchMinutes: tournament.matchMinutes,
            breakMinutes: tournament.breakMinutes,
          }).map((m) => matchRow(tournament.id, m)),
        });
        await tx.tournament.update({
          where: { id: tournament.id },
          data: { drawSeed: used, swissRounds: swissRoundCount(teams.length) },
        });
        return;
      }
      let draw;
      try {
        draw = drawTournament({
          format: FORMAT_KIND[tournament.format] as FormatKind,
          teams: teams.map((t) => t.code),
          seed: used,
        });
      } catch (error) {
        throw new UnprocessableEntityException((error as Error).message);
      }
      const scheduled = scheduleMatches(draw.matches, {
        startsAt: tournament.startsAt.getTime(),
        fields: tournament.fieldCount,
        matchMinutes: tournament.matchMinutes,
        breakMinutes: tournament.breakMinutes,
      });
      await tx.match.deleteMany({ where: { tournamentId: tournament.id } });
      await tx.team.updateMany({
        where: { tournamentId: tournament.id },
        data: { group: null },
      });
      for (const group of draw.groups) {
        await tx.team.updateMany({
          where: { tournamentId: tournament.id, code: { in: group.teams } },
          data: { group: group.group },
        });
      }
      await tx.match.createMany({
        data: scheduled.map((m) => matchRow(tournament.id, m)),
      });
      await tx.tournament.update({
        where: { id: tournament.id },
        data: { drawSeed: used },
      });
    });
    return this.view(organizationSlug, slug);
  }

  /**
   * Vainqueur d'un match à élimination terminé sur un nul (tirs au but),
   * quand la table de marque ne l'a pas indiqué.
   */
  async setWinner(
    organizationSlug: string,
    slug: string,
    code: string,
    input: WinnerInput,
  ): Promise<void> {
    const tournament = await this.own(organizationSlug, slug);
    const match = await this.prisma.match.findUnique({
      where: { tournamentId_code: { tournamentId: tournament.id, code } },
    });
    if (!match) {
      throw new NotFoundException('Match introuvable.');
    }
    if (
      match.phase === 'groups' ||
      match.phase === 'swiss' ||
      match.status !== 'FINISHED' ||
      match.scoreHome !== match.scoreAway
    ) {
      throw new ConflictException(
        'Seul un match à élimination terminé sur un nul attend un vainqueur.',
      );
    }
    await this.prisma.match.update({
      where: { id: match.id },
      data: { winnerSide: input.side === 'home' ? 'HOME' : 'AWAY' },
    });
    await this.advance(tournament.id);
  }

  /**
   * Place les équipes connues dans les matchs du tableau pas encore
   * commencés (classement des poules terminées, vainqueurs et perdants).
   */
  async advance(tournamentId: string): Promise<void> {
    await this.advanceMatches(tournamentId);
    // Podium connu (ou annulé) : le tournoi passe terminé (ou de nouveau en cours).
    await this.palmares.settle(tournamentId);
  }

  private async advanceMatches(tournamentId: string): Promise<void> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { teams: true, matches: true },
    });
    if (tournament?.format === 'SWISS') {
      await this.advanceSwiss(tournamentId);
      return;
    }
    if (
      !tournament ||
      !tournament.matches.some((m) => m.homeSource || m.awaySource)
    ) {
      return;
    }
    const rules = rulesFor(
      tournament.sport,
      storedRules(tournament.rankingRules),
    );
    const standings = computeStandings(
      tournament.teams.map((t) => ({
        id: t.code,
        name: t.name,
        group: t.group,
      })),
      tournament.matches
        .filter((m) => m.phase === 'groups')
        .map((m) => ({
          homeTeamId: m.homeTeamCode,
          awayTeamId: m.awayTeamCode,
          scoreHome: m.scoreHome,
          scoreAway: m.scoreAway,
          finished: m.status === 'FINISHED',
        })),
      rules,
    );
    const changes = advanceBracket(
      tournament.matches.map((m) => ({
        code: m.code,
        group: m.phase === 'groups' ? m.group : null,
        homeTeam: m.homeTeamCode,
        awayTeam: m.awayTeamCode,
        homeSource: m.homeSource,
        awaySource: m.awaySource,
        scoreHome: m.scoreHome,
        scoreAway: m.scoreAway,
        finished: m.status === 'FINISHED',
        winnerSide:
          m.winnerSide === 'HOME'
            ? 'home'
            : m.winnerSide === 'AWAY'
              ? 'away'
              : null,
        started: m.status !== 'SCHEDULED',
      })),
      standings,
    );
    for (const change of changes) {
      // Seul un match encore à venir reçoit ses équipes.
      await this.prisma.match.updateMany({
        where: { tournamentId, code: change.code, status: 'SCHEDULED' },
        data: { homeTeamCode: change.homeTeam, awayTeamCode: change.awayTeam },
      });
    }
    if (changes.length > 0) {
      this.logger.log(
        `Tableau : ${changes.map((c) => c.code).join(', ')} mis à jour.`,
      );
    }
  }

  /**
   * Système suisse : dès que toutes les rondes appariées sont terminées, la
   * suivante est appariée et programmée après la dernière. Une ronde pas
   * encore commencée suit les résultats : elle est appariée de nouveau si
   * un score précédent est corrigé, retirée si une ronde précédente n'est
   * plus terminée. Un verrou par tournoi évite deux appariements simultanés.
   */
  private async advanceSwiss(tournamentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tournamentId}))`;
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: tournamentId },
        include: {
          teams: { select: { code: true, name: true, byeRounds: true } },
          matches: { where: { phase: 'swiss' } },
        },
      });
      const total = tournament.swissRounds ?? 0;
      const matches = tournament.matches;
      const last = Math.max(0, ...matches.map((m) => m.round ?? 0));
      if (total === 0 || last === 0) {
        return;
      }
      const inRound = (round: number) =>
        matches.filter((m) => m.round === round);
      const finished = (round: number) =>
        inRound(round).every((m) => m.status === 'FINISHED');
      const lastStarted = inRound(last).some((m) => m.status !== 'SCHEDULED');

      let target: number;
      if (!lastStarted && last > 1) {
        // Ronde à venir : elle suit les résultats des précédentes.
        if (!finished(last - 1)) {
          await this.dropRound(tx, tournamentId, last);
          return;
        }
        target = last;
      } else if (finished(last) && last < total) {
        target = last + 1;
      } else {
        return;
      }

      const results = matches
        .filter((m) => (m.round ?? 0) < target)
        .map((m) => ({
          homeTeamId: m.homeTeamCode,
          awayTeamId: m.awayTeamCode,
          scoreHome: m.scoreHome,
          scoreAway: m.scoreAway,
          finished: m.status === 'FINISHED',
        }));
      const byes = tournament.teams.flatMap((t) =>
        t.byeRounds.filter((r) => r < target).map(() => t.code),
      );
      const paired = pairSwissRound({
        teams: tournament.teams.map((t) => ({ id: t.code, name: t.name })),
        results,
        byes,
        round: target,
        seed: tournament.drawSeed ?? tournament.id,
        rules: rulesFor(tournament.sport, storedRules(tournament.rankingRules)),
      });

      if (target === last) {
        const current = inRound(last);
        const pairs = (list: { home: string | null; away: string | null }[]) =>
          list
            .map((p) => `${p.home}|${p.away}`)
            .sort()
            .join(',');
        const byeNow =
          tournament.teams.find((t) => t.byeRounds.includes(last))?.code ??
          null;
        if (
          byeNow === paired.bye &&
          pairs(
            current.map((m) => ({
              home: m.homeTeamCode,
              away: m.awayTeamCode,
            })),
          ) ===
            pairs(
              paired.matches.map((m) => ({
                home: m.homeTeam,
                away: m.awayTeam,
              })),
            )
        ) {
          return;
        }
        await this.dropRound(tx, tournamentId, last);
      }

      // La ronde commence après la fin prévue de la précédente.
      const previous = inRound(target - 1);
      const startsAt =
        Math.max(...previous.map((m) => m.startsAt.getTime())) +
        (tournament.matchMinutes + tournament.breakMinutes) * 60_000;
      await tx.match.createMany({
        data: scheduleMatches(paired.matches, {
          startsAt,
          fields: tournament.fieldCount,
          matchMinutes: tournament.matchMinutes,
          breakMinutes: tournament.breakMinutes,
        }).map((m) => matchRow(tournamentId, m)),
      });
      if (paired.bye) {
        const team = tournament.teams.find((t) => t.code === paired.bye)!;
        await tx.team.updateMany({
          where: { tournamentId, code: paired.bye },
          data: {
            byeRounds: [...team.byeRounds.filter((r) => r < target), target],
          },
        });
      }
      this.logger.log(`Système suisse : ronde ${target} appariée.`);
    });
  }

  /** Retire une ronde pas encore commencée et ses exemptions. */
  private async dropRound(
    tx: Prisma.TransactionClient,
    tournamentId: string,
    round: number,
  ): Promise<void> {
    await tx.match.deleteMany({
      where: { tournamentId, phase: 'swiss', round, status: 'SCHEDULED' },
    });
    const exempt = await tx.team.findMany({
      where: { tournamentId, byeRounds: { has: round } },
      select: { id: true, byeRounds: true },
    });
    for (const team of exempt) {
      await tx.team.update({
        where: { id: team.id },
        data: { byeRounds: team.byeRounds.filter((r) => r !== round) },
      });
    }
  }

  private async own(organizationSlug: string, slug: string) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    return tournament;
  }
}

/** Ligne de match à créer à partir du calendrier du moteur. */
function matchRow(tournamentId: string, m: ScheduledMatch) {
  return {
    tournamentId,
    code: m.code,
    phase: m.phase,
    group: m.group,
    round: m.phase === 'swiss' ? m.round : null,
    field: m.field,
    startsAt: new Date(m.startsAt),
    homeTeamCode: m.homeTeam,
    awayTeamCode: m.awayTeam,
    homeSource: m.homeSource,
    awaySource: m.awaySource,
    homePlaceholder: m.homeSource ? sourceLabel(m.homeSource) : null,
    awayPlaceholder: m.awaySource ? sourceLabel(m.awaySource) : null,
  };
}
