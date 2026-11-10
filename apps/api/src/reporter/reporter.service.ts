import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { replayFeed } from '../public/match-feed.js';
import {
  PUBLIC_STATUSES,
  toIso,
  toPublicPhase,
} from '../public/public-mapping.js';
import { LINK_TTL_MS, ReporterLinkSigner } from './reporter-link.js';
import type {
  ReporterEvent,
  ReporterLink,
  ReporterMatch,
  ReporterState,
} from './reporter.schemas.js';

const SIDES = { home: 'HOME', away: 'AWAY' } as const;

/**
 * Table de marque du rapporteur : un lien signé ouvre un seul match ; chaque
 * saisie est ajoutée au fil (insertion seule, idempotente par clientEventId)
 * puis le score, la minute et le statut du match sont recalculés à partir du
 * fil complet.
 */
@Injectable()
export class ReporterService {
  private readonly signer: ReporterLinkSigner | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {
    const secret = config.get('ORGANIZER_DEMO_TOKEN', { infer: true });
    this.signer = secret ? new ReporterLinkSigner(secret) : null;
  }

  /** Lien d'un match de l'organisation (404 sinon, jamais 403). */
  async issueLink(
    organizationSlug: string,
    tournamentSlug: string,
    code: string,
  ): Promise<ReporterLink> {
    const match = await this.prisma.match.findFirst({
      where: {
        code,
        tournament: {
          slug: tournamentSlug,
          organization: { slug: organizationSlug },
        },
      },
      select: { id: true },
    });
    if (!match || !this.signer) {
      throw new NotFoundException('Match introuvable.');
    }
    const expiresAt = new Date(this.clock.now().getTime() + LINK_TTL_MS);
    const token = this.signer.sign(match.id, expiresAt);
    const base = this.config
      .get('PUBLIC_APP_URL', { infer: true })
      .replace(/\/$/, '');
    return { token, url: `${base}/r/${token}`, expiresAt: toIso(expiresAt) };
  }

  async match(token: string): Promise<ReporterMatch> {
    const match = await this.prisma.match.findUnique({
      where: { id: this.matchIdOf(token) },
      include: { tournament: true },
    });
    if (!match || !PUBLIC_STATUSES.includes(match.tournament.status as never)) {
      throw new NotFoundException('Lien de saisie invalide ou expiré.');
    }
    const teams = await this.prisma.team.findMany({
      where: {
        tournamentId: match.tournamentId,
        code: {
          in: [match.homeTeamCode, match.awayTeamCode].filter(
            (c) => c !== null,
          ),
        },
      },
      include: { players: { orderBy: { number: 'asc' } } },
    });
    const team = (code: string | null, placeholder: string | null) => {
      const found = teams.find((t) => t.code === code);
      return {
        name: found?.name ?? placeholder ?? '—',
        shortName: found?.shortName ?? '?',
        players: (found?.players ?? []).map((p) => ({
          number: p.number,
          name: p.name,
        })),
      };
    };
    return {
      token,
      tournamentSlug: match.tournament.slug,
      tournamentName: match.tournament.name,
      matchId: match.code,
      phase: toPublicPhase(match.phase),
      field: match.field,
      startsAt: toIso(match.startsAt),
      home: team(match.homeTeamCode, match.homePlaceholder),
      away: team(match.awayTeamCode, match.awayPlaceholder),
      matchMinutes: match.tournament.matchMinutes,
      status: match.status,
    };
  }

  async record(token: string, input: ReporterEvent): Promise<ReporterState> {
    const matchId = this.matchIdOf(token);
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: { id: true },
      });
      if (!match) {
        throw new NotFoundException('Lien de saisie invalide ou expiré.');
      }
      const cancelled = input.cancels
        ? await tx.matchEvent.findUnique({
            where: {
              matchId_clientEventId: { matchId, clientEventId: input.cancels },
            },
            select: { id: true },
          })
        : null;
      await tx.matchEvent.createMany({
        data: [
          {
            matchId,
            clientEventId: input.clientEventId,
            type: input.type,
            side: input.side ? SIDES[input.side] : null,
            minute: input.minute,
            player: input.player ?? null,
            assist: input.assist ?? null,
            caption: input.caption ?? null,
            cancelsId: cancelled?.id ?? null,
            createdAt: this.clock.now(),
          },
        ],
        skipDuplicates: true,
      });
      const events = await tx.matchEvent.findMany({
        where: { matchId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const feed = replayFeed(events);
      const score = feed[0]?.score ?? { home: 0, away: 0 };
      const status = feed.some((e) => e.type === 'FULL_TIME')
        ? 'FINISHED'
        : 'LIVE';
      await tx.match.update({
        where: { id: matchId },
        data: {
          scoreHome: score.home,
          scoreAway: score.away,
          status,
          minute:
            status === 'LIVE'
              ? Math.max(0, ...feed.map((e) => e.minute))
              : null,
          version: { increment: 1 },
        },
      });
      return { score, status };
    });
  }

  private matchIdOf(token: string): string {
    const matchId = this.signer?.verify(token, this.clock.now()) ?? null;
    if (!matchId) {
      throw new NotFoundException('Lien de saisie invalide ou expiré.');
    }
    return matchId;
  }
}
