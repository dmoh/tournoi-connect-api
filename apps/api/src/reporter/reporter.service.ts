import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthKeys } from '../auth/auth-keys.js';
import { AUTH_KEYS } from '../auth/auth.tokens.js';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  PhotoUpload,
  PhotoUploadRequest,
  PublicPhoto,
} from '../media/media.schemas.js';
import { MediaService } from '../media/media.service.js';
import { PushService } from '../push/push.service.js';
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
    @Inject(AUTH_KEYS) keys: AuthKeys | null,
    private readonly push: PushService,
    private readonly media: MediaService,
  ) {
    this.signer = keys ? new ReporterLinkSigner(keys.reporter) : null;
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

  /** URL d'envoi d'une photo du match (la table de marque n'a pas de compte). */
  async requestPhoto(
    token: string,
    input: PhotoUploadRequest,
  ): Promise<PhotoUpload> {
    const match = await this.openMatch(token);
    return this.media.requestUpload(
      {
        tournamentId: match.tournamentId,
        matchId: match.id,
        source: 'REPORTER',
        uploadedById: null,
      },
      input,
    );
  }

  async confirmPhoto(token: string, photoId: string): Promise<PublicPhoto> {
    const match = await this.openMatch(token);
    return this.media.confirm(photoId, {
      matchId: match.id,
      source: 'REPORTER',
    });
  }

  async record(token: string, input: ReporterEvent): Promise<ReporterState> {
    const matchId = this.matchIdOf(token);
    if (input.photoId) {
      const photo = await this.prisma.photo.findFirst({
        where: {
          id: input.photoId,
          matchId,
          status: 'READY',
          deletedAt: null,
          hiddenAt: null,
        },
        select: { id: true },
      });
      if (!photo) {
        throw new NotFoundException('Photo introuvable.');
      }
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        select: {
          id: true,
          code: true,
          status: true,
          homeTeamCode: true,
          awayTeamCode: true,
          tournamentId: true,
          tournament: { select: { slug: true } },
        },
      });
      if (!match) {
        throw new NotFoundException('Lien de saisie invalide ou expiré.');
      }
      const cancelled = input.cancels
        ? await tx.matchEvent.findUnique({
            where: {
              matchId_clientEventId: { matchId, clientEventId: input.cancels },
            },
            select: { id: true, photoId: true },
          })
        : null;
      const inserted = await tx.matchEvent.createMany({
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
            photoId: input.photoId ?? null,
            cancelsId: cancelled?.id ?? null,
            createdAt: this.clock.now(),
          },
        ],
        skipDuplicates: true,
      });
      const events = await tx.matchEvent.findMany({
        where: { matchId },
        orderBy: { seq: 'asc' },
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
      return {
        state: { score, status } as ReporterState,
        // Saisie nouvelle (un renvoi de la file hors ligne ne notifie pas deux fois).
        fresh: inserted.count > 0,
        previous: match.status,
        match,
        minute: input.minute,
        // Photo d'un événement annulé : retirée avec lui.
        cancelledPhotoId: inserted.count > 0 ? cancelled?.photoId : null,
      };
    });
    if (result.cancelledPhotoId) {
      await this.media.remove({ id: result.cancelledPhotoId });
    }
    if (result.fresh) {
      await this.notify(input, result).catch(() => undefined);
    }
    return result.state;
  }

  /** Coup d'envoi, but ou fin du match : notification aux appareils qui suivent. */
  private async notify(
    input: ReporterEvent,
    result: {
      state: ReporterState;
      previous: string;
      match: {
        code: string;
        homeTeamCode: string | null;
        awayTeamCode: string | null;
        tournamentId: string;
        tournament: { slug: string };
      };
      minute: number;
    },
  ): Promise<void> {
    const { match, state } = result;
    const kind =
      input.type === 'GOAL'
        ? 'goal'
        : input.type === 'FULL_TIME'
          ? 'result'
          : result.previous === 'SCHEDULED'
            ? 'kickoff'
            : null;
    if (!kind) {
      return;
    }
    const teams = await this.prisma.team.findMany({
      where: {
        tournamentId: match.tournamentId,
        code: {
          in: [match.homeTeamCode, match.awayTeamCode].filter(
            (c): c is string => c !== null,
          ),
        },
      },
      select: { code: true, name: true },
    });
    const name = (code: string | null) =>
      teams.find((t) => t.code === code)?.name ?? '?';
    const home = name(match.homeTeamCode);
    const away = name(match.awayTeamCode);
    const score = `${home} ${state.score.home} – ${state.score.away} ${away}`;
    const scorer =
      input.side === 'home' ? home : input.side === 'away' ? away : null;
    const content = {
      kickoff: { title: 'Coup d’envoi', body: `${home} – ${away}` },
      goal: {
        title: scorer ? `But pour ${scorer} !` : 'But !',
        body: `${score} (${input.minute}’)${input.player ? ` · ${input.player}` : ''}`,
      },
      result: { title: 'Fin du match', body: score },
    }[kind];
    await this.push.notify({
      kind,
      tournamentSlug: match.tournament.slug,
      matchCode: match.code,
      homeTeam: match.homeTeamCode,
      awayTeam: match.awayTeamCode,
      ...content,
    });
  }

  /** Match d'un lien valide, dans un tournoi public et non masqué. */
  private async openMatch(token: string) {
    const match = await this.prisma.match.findFirst({
      where: {
        id: this.matchIdOf(token),
        tournament: { status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      },
      select: { id: true, tournamentId: true },
    });
    if (!match) {
      throw new NotFoundException('Lien de saisie invalide ou expiré.');
    }
    return match;
  }

  private matchIdOf(token: string): string {
    const matchId = this.signer?.verify(token, this.clock.now()) ?? null;
    if (!matchId) {
      throw new NotFoundException('Lien de saisie invalide ou expiré.');
    }
    return matchId;
  }
}
