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
  rulesFor,
  scheduleMatches,
  sourceLabel,
  type FormatKind,
} from '@dmoh/tournoi-connect-engine';
import { randomBytes } from 'node:crypto';
import { storedRules } from '../common/ranking-rules.schema.js';
import { PrismaService } from '../database/prisma.service.js';
import type { TournamentFormat } from '../generated/prisma/enums.js';
import type { DrawView, WinnerInput } from './bracket.schemas.js';

const FORMAT_KIND: Record<TournamentFormat, DrawView['format']> = {
  SINGLE_GROUP: 'single-group',
  GROUPS_KNOCKOUT: 'groups-knockout',
  KNOCKOUT: 'knockout',
  SWISS: 'swiss',
};

/**
 * Tirage des poules, calendrier des matchs et avancement du tableau final
 * (moteur du tournoi). Le tirage se refait tant qu'aucun match n'a commencé ;
 * ensuite, chaque fin de match place les qualifiés et les vainqueurs.
 */
@Injectable()
export class BracketService {
  private readonly logger = new Logger(BracketService.name);

  constructor(private readonly prisma: PrismaService) {}

  async view(organizationSlug: string, slug: string): Promise<DrawView> {
    const tournament = await this.own(organizationSlug, slug);
    const [teams, matches] = await Promise.all([
      this.prisma.team.findMany({
        where: { tournamentId: tournament.id },
        orderBy: { name: 'asc' },
      }),
      this.prisma.match.findMany({
        where: { tournamentId: tournament.id },
        select: { status: true, startsAt: true },
      }),
    ]);
    const groups = [
      ...new Set(teams.map((t) => t.group).filter((g): g is string => !!g)),
    ].sort();
    const last = matches.reduce<Date | null>(
      (latest, m) => (!latest || m.startsAt > latest ? m.startsAt : latest),
      null,
    );
    const endsAt = last
      ? new Date(last.getTime() + tournament.matchMinutes * 60_000)
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
   * 409 si un match a commencé ou s'il manque des équipes, 422 pour le
   * système suisse (ses rondes se tirent au fil des résultats).
   */
  async draw(
    organizationSlug: string,
    slug: string,
    seed?: string,
  ): Promise<DrawView> {
    const tournament = await this.own(organizationSlug, slug);
    if (tournament.format === 'SWISS') {
      throw new UnprocessableEntityException(
        'Le système suisse n’a pas encore de tirage automatique.',
      );
    }
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
        data: scheduled.map((m) => ({
          tournamentId: tournament.id,
          code: m.code,
          phase: m.phase,
          group: m.group,
          field: m.field,
          startsAt: new Date(m.startsAt),
          homeTeamCode: m.homeTeam,
          awayTeamCode: m.awayTeam,
          homeSource: m.homeSource,
          awaySource: m.awaySource,
          homePlaceholder: m.homeSource ? sourceLabel(m.homeSource) : null,
          awayPlaceholder: m.awaySource ? sourceLabel(m.awaySource) : null,
        })),
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
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { teams: true, matches: true },
    });
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
