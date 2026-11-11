import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthKeys } from '../auth/auth-keys.js';
import { AUTH_KEYS } from '../auth/auth.tokens.js';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PushService } from '../push/push.service.js';
import { replayFeed } from '../public/match-feed.js';
import {
  PUBLIC_STATUSES,
  toIso,
  toPublicPhase,
} from '../public/public-mapping.js';
import { cleanText, goalNotified } from './reporter-input.js';
import { LINK_TTL_MS, ReporterLinkSigner } from './reporter-link.js';
import type {
  ReporterEvent,
  ReporterLink,
  ReporterMatch,
  ReporterState,
} from './reporter.schemas.js';

const SIDES = { home: 'HOME', away: 'AWAY' } as const;
const INVALID_LINK = 'Lien de saisie invalide, expiré ou révoqué.';

/**
 * Table de marque du rapporteur : un lien signé, enregistré et révocable,
 * ouvre un seul match. Chaque saisie est ajoutée au fil (insertion seule,
 * idempotente par clientEventId) sous verrou du match, qui porte le score, la
 * minute et le statut ; une annulation les recalcule à partir du fil.
 * Tournoi plus public ou match terminé : 409 (seule la fin du match peut
 * encore être annulée).
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
  ) {
    this.signer = keys ? new ReporterLinkSigner(keys.reporter) : null;
  }

  /** Lien d'un match de l'organisation (404 sinon, jamais 403), enregistré au nom du membre. */
  async issueLink(
    organizationSlug: string,
    userId: string,
    tournamentSlug: string,
    code: string,
  ): Promise<ReporterLink> {
    const match = await this.findMatch(organizationSlug, tournamentSlug, code);
    if (!this.signer) {
      throw new NotFoundException('Match introuvable.');
    }
    const expiresAt = new Date(this.clock.now().getTime() + LINK_TTL_MS);
    const link = await this.prisma.reporterLink.create({
      data: {
        matchId: match.id,
        organizationId: match.tournament.organizationId,
        issuedById: userId,
        expiresAt,
      },
      select: { id: true },
    });
    const token = this.signer.sign(link.id, expiresAt);
    const base = this.config
      .get('PUBLIC_APP_URL', { infer: true })
      .replace(/\/$/, '');
    return { token, url: `${base}/r/${token}`, expiresAt: toIso(expiresAt) };
  }

  /** Révoque tous les liens encore actifs d'un match de l'organisation. */
  async revokeLinks(
    organizationSlug: string,
    tournamentSlug: string,
    code: string,
  ): Promise<void> {
    const match = await this.findMatch(organizationSlug, tournamentSlug, code);
    await this.prisma.reporterLink.updateMany({
      where: { matchId: match.id, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  private async findMatch(
    organizationSlug: string,
    tournamentSlug: string,
    code: string,
  ) {
    const match = await this.prisma.match.findFirst({
      where: {
        code,
        tournament: {
          slug: tournamentSlug,
          organization: { slug: organizationSlug },
        },
      },
      select: { id: true, tournament: { select: { organizationId: true } } },
    });
    if (!match) {
      throw new NotFoundException('Match introuvable.');
    }
    return match;
  }

  async match(token: string): Promise<ReporterMatch> {
    const match = await this.prisma.match.findUnique({
      where: { id: await this.openLink(this.prisma, token) },
      include: { tournament: true },
    });
    if (!match || !PUBLIC_STATUSES.includes(match.tournament.status as never)) {
      throw new NotFoundException(INVALID_LINK);
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

  async record(token: string, raw: ReporterEvent): Promise<ReporterState> {
    const input: ReporterEvent = {
      ...raw,
      player: cleanText(raw.player),
      assist: cleanText(raw.assist),
      caption: cleanText(raw.caption),
    };
    const now = this.clock.now();
    const result = await this.prisma.$transaction(async (tx) => {
      const matchId = await this.openLink(tx, token);
      // Verrou du match : deux saisies simultanées s'appliquent l'une après
      // l'autre, chacune sur le score laissé par la précédente.
      await tx.$queryRaw`SELECT id FROM match WHERE id = ${matchId} FOR UPDATE`;
      const match = await tx.match.findUniqueOrThrow({
        where: { id: matchId },
        select: {
          id: true,
          code: true,
          status: true,
          scoreHome: true,
          scoreAway: true,
          minute: true,
          homeTeamCode: true,
          awayTeamCode: true,
          tournamentId: true,
          tournament: { select: { slug: true, status: true } },
        },
      });
      const current: ReporterState = {
        score: { home: match.scoreHome, away: match.scoreAway },
        status: match.status,
      };
      if (!PUBLIC_STATUSES.includes(match.tournament.status as never)) {
        throw new ConflictException(
          'Le tournoi n’est plus ouvert : les scores ne se saisissent plus.',
        );
      }
      const target = input.cancels
        ? await tx.matchEvent.findUnique({
            where: {
              matchId_clientEventId: { matchId, clientEventId: input.cancels },
            },
            select: { id: true, type: true, matchId: true },
          })
        : null;
      const existing = await tx.matchEvent.findUnique({
        where: {
          matchId_clientEventId: {
            matchId,
            clientEventId: input.clientEventId,
          },
        },
      });
      if (existing) {
        // Renvoi de la file hors ligne : compté une fois, sans notification.
        if (!sameEvent(existing, input, target?.id ?? null)) {
          throw new ConflictException(
            'Cet identifiant de saisie a déjà servi pour une autre saisie.',
          );
        }
        return { state: current, notify: null, match, previous: match.status };
      }
      if (input.type === 'CANCEL') {
        await this.checkCancel(tx, target, match.status);
      } else if (match.status === 'FINISHED') {
        throw new ConflictException(
          'Le match est terminé : annulez d’abord la fin du match pour corriger la saisie.',
        );
      }
      await tx.matchEvent.create({
        data: {
          matchId,
          clientEventId: input.clientEventId,
          type: input.type,
          side: input.side ? SIDES[input.side] : null,
          minute: input.minute,
          player: input.player ?? null,
          assist: input.assist ?? null,
          caption: input.caption ?? null,
          cancelsId: input.type === 'CANCEL' ? target!.id : null,
          createdAt: now,
        },
      });
      const next =
        input.type === 'CANCEL'
          ? await this.replay(tx, matchId)
          : advance(match, input);
      await tx.match.update({
        where: { id: matchId },
        data: {
          scoreHome: next.score.home,
          scoreAway: next.score.away,
          status: next.status,
          minute: next.minute,
          version: { increment: 1 },
        },
      });
      return {
        state: { score: next.score, status: next.status } as ReporterState,
        notify:
          input.type === 'GOAL' ? await this.notifiesGoal(tx, matchId) : true,
        match,
        previous: match.status,
      };
    });
    if (result.notify) {
      await this.notify(input, result).catch(() => undefined);
    }
    return result.state;
  }

  /**
   * Annulation : l'événement visé existe dans ce match, n'est ni une
   * annulation ni déjà annulé. Match terminé : seule la fin du match s'annule
   * (fin sifflée par erreur) ; le match repart alors en direct.
   */
  private async checkCancel(
    tx: Tx,
    target: { id: string; type: string; matchId: string } | null,
    status: string,
  ): Promise<void> {
    if (!target) {
      throw new ConflictException(
        'L’événement à annuler n’existe pas dans ce match.',
      );
    }
    if (target.type === 'CANCEL') {
      throw new ConflictException('Une annulation ne s’annule pas.');
    }
    if (status === 'FINISHED' && target.type !== 'FULL_TIME') {
      throw new ConflictException(
        'Le match est terminé : seule la fin du match peut être annulée.',
      );
    }
    const already = await tx.matchEvent.findFirst({
      where: { matchId: target.matchId, type: 'CANCEL', cancelsId: target.id },
      select: { id: true },
    });
    if (already) {
      throw new ConflictException('Cet événement est déjà annulé.');
    }
  }

  /** Après une annulation : score, statut et minute rejoués depuis le fil. */
  private async replay(tx: Tx, matchId: string): Promise<Progress> {
    const events = await tx.matchEvent.findMany({
      where: { matchId },
      orderBy: { seq: 'asc' },
    });
    const feed = replayFeed(events);
    const status = feed.some((e) => e.type === 'FULL_TIME')
      ? 'FINISHED'
      : 'LIVE';
    return {
      score: feed[0]?.score ?? { home: 0, away: 0 },
      status,
      minute:
        status === 'LIVE' ? Math.max(0, ...feed.map((e) => e.minute)) : null,
    };
  }

  /** Plafond des notifications de but (voir goalNotified). */
  private async notifiesGoal(tx: Tx, matchId: string): Promise<boolean> {
    const goals = await tx.matchEvent.findMany({
      where: { matchId, type: 'GOAL' },
      orderBy: { seq: 'asc' },
      select: { createdAt: true },
    });
    return goalNotified(goals.map((g) => g.createdAt));
  }

  /**
   * Match du lien, s'il est intact, ni expiré ni révoqué (404 sinon, même
   * réponse dans tous les cas).
   */
  private async openLink(
    db: Pick<Tx, 'reporterLink'>,
    token: string,
  ): Promise<string> {
    const now = this.clock.now();
    const id = this.signer?.verify(token, now) ?? null;
    const link = id
      ? await db.reporterLink.findUnique({
          where: { id },
          select: { matchId: true, expiresAt: true, revokedAt: true },
        })
      : null;
    if (!link || link.revokedAt || link.expiresAt <= now) {
      throw new NotFoundException(INVALID_LINK);
    }
    return link.matchId;
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
      // Identifiant de la tâche push : une notification par saisie, jamais fusionnée sur le texte.
      eventId: input.clientEventId,
      ...content,
    });
  }
}

type Tx = Prisma.TransactionClient;

interface Progress {
  score: { home: number; away: number };
  status: 'LIVE' | 'FINISHED';
  minute: number | null;
}

/**
 * Saisie nouvelle hors annulation, appliquée au match verrouillé : le score
 * enregistré est celui du fil (chaque saisie le met à jour sous verrou), seule
 * une annulation oblige à rejouer le fil.
 */
function advance(
  match: { scoreHome: number; scoreAway: number; minute: number | null },
  input: ReporterEvent,
): Progress {
  const score = { home: match.scoreHome, away: match.scoreAway };
  if (input.type === 'GOAL' && input.side) {
    score[input.side] += 1;
  }
  const status = input.type === 'FULL_TIME' ? 'FINISHED' : 'LIVE';
  return {
    score,
    status,
    minute:
      status === 'LIVE' ? Math.max(match.minute ?? 0, input.minute) : null,
  };
}

/** Renvoi identique d'une saisie déjà enregistrée (même clientEventId). */
function sameEvent(
  stored: {
    type: string;
    side: string | null;
    minute: number;
    player: string | null;
    assist: string | null;
    caption: string | null;
    cancelsId: string | null;
  },
  input: ReporterEvent,
  targetId: string | null,
): boolean {
  return (
    stored.type === input.type &&
    stored.side === (input.side ? SIDES[input.side] : null) &&
    stored.minute === input.minute &&
    stored.player === (input.player ?? null) &&
    stored.assist === (input.assist ?? null) &&
    stored.caption === (input.caption ?? null) &&
    (input.type !== 'CANCEL' || stored.cancelsId === targetId)
  );
}
