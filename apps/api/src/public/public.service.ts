import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { computeStandings } from '@dmoh/tournoi-connect-engine';
import {
  AudienceWriter,
  type AudienceJob,
} from '../audience/audience-writer.js';
import { Clock } from '../common/clock.js';
import {
  decodeCursor,
  encodeCursor,
  seekAfter,
  seekOrder,
  takePage,
  type Page,
  type PageQuery,
} from '../common/pagination.js';
import { parisDate, parisDateTime } from '../common/paris-time.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Placement } from '../generated/prisma/enums.js';
import { AUDIENCE_QUEUE } from '../queue/queue.module.js';
import { composeFeed } from './feed.js';
import { replayFeed } from './match-feed.js';
import {
  DISCOVERABLE_STATUSES,
  PUBLIC_STATUSES,
  toIso,
  toPublicPhase,
  toSummary,
} from './public-mapping.js';
import type {
  DayMatches,
  NearbyTournament,
  PublicMatch,
  SearchQuery,
  TournamentDetail,
} from './public.schemas.js';
import type { Match } from '../generated/prisma/client.js';
import { z } from 'zod';
import type {
  AudienceEvent,
  MatchFeed,
  NewsItem,
  ReactionCounts,
  ReactionInput,
  PollResult,
  PublicSponsors,
  SponsorCard,
} from './public-l5.schemas.js';

const KM_PER_DEGREE_LAT = 111;
const MAX_ROTATION = 6;

/**
 * Bornes des listes non paginées d'un tournoi (naturellement petites) :
 * 128 équipes au plus (maxTeams), quelques centaines de matchs, des
 * dizaines d'événements par match, des sponsors limités par les packs.
 */
export const MAX_TEAMS = 128;
export const MAX_MATCHES = 1000;
export const MAX_MATCH_EVENTS = 1000;
export const MAX_PAID_SPONSORS = 100;
/** Journées d'un tournoi lues pour les ancres `?day=`. */
const MAX_DAYS = 60;

const explorerCursor = z.tuple([
  z.number().nonnegative(),
  z.iso.datetime({ offset: true }),
  z.string().min(1).max(64),
]);
const newsCursor = z.tuple([
  z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
  z.string().min(1).max(64),
  /** Cartes sponsorisées déjà montrées : la rotation continue. */
  z.number().int().nonnegative().max(1_000_000),
]);

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audienceWriter: AudienceWriter,
    @Optional()
    @InjectQueue(AUDIENCE_QUEUE)
    private readonly audienceQueue?: Queue<AudienceJob>,
  ) {}

  /**
   * Tournois en cours ou à venir dans le rayon, triés par distance, date
   * puis id, paginés par curseur sur ce triplet. Distance haversine en SQL,
   * préfiltrée par une boîte lat/lng indexée ; PostGIS (ST_DWithin, GiST)
   * remplacera ce calcul (plan, section 4). La distance est recalculée à
   * l'identique d'une page à l'autre (mêmes paramètres, float8 rendu et
   * relu sans perte) : le curseur la compare exactement.
   */
  async search(query: SearchQuery): Promise<Page<NearbyTournament>> {
    const after = query.cursor
      ? decodeCursor(query.cursor, 'explorer', explorerCursor)
      : null;
    const dLat = query.radiusKm / KM_PER_DEGREE_LAT;
    const dLng =
      query.radiusKm /
      (KM_PER_DEGREE_LAT * Math.cos((query.lat * Math.PI) / 180));
    const rows = await this.prisma.$queryRaw<
      { id: string; starts_at: Date; distance_km: number }[]
    >`
      SELECT t.id, t.starts_at, d.distance_km
      FROM tournament t
      JOIN venue v ON v.id = t.venue_id
      CROSS JOIN LATERAL (
        SELECT 2 * 6371 * asin(sqrt(
          power(sin(radians(v.lat - ${query.lat}) / 2), 2)
          + cos(radians(${query.lat})) * cos(radians(v.lat))
          * power(sin(radians(v.lng - ${query.lng}) / 2), 2)
        )) AS distance_km
      ) d
      WHERE t.status::text IN (${Prisma.join([...DISCOVERABLE_STATUSES])})
        AND t.ends_at >= ${this.clock.now()}
        AND v.lat BETWEEN ${query.lat - dLat} AND ${query.lat + dLat}
        AND v.lng BETWEEN ${query.lng - dLng} AND ${query.lng + dLng}
        AND (${query.sport ?? null}::text IS NULL OR t.sport::text = ${query.sport ?? null})
        AND d.distance_km <= ${query.radiusKm}
        ${
          after
            ? Prisma.sql`AND (d.distance_km, t.starts_at, t.id) > (${after[0]}::float8, ${after[1]}::timestamptz, ${after[2]}::text)`
            : Prisma.empty
        }
      ORDER BY d.distance_km, t.starts_at, t.id
      LIMIT ${query.limit + 1}`;

    const page = takePage(rows, query.limit, (row) =>
      encodeCursor('explorer', [
        Number(row.distance_km),
        row.starts_at.toISOString(),
        row.id,
      ]),
    );
    const tournaments = await this.prisma.tournament.findMany({
      where: { id: { in: page.rows.map((row) => row.id) } },
      include: { venue: true, organization: true },
      take: query.limit,
    });
    const byId = new Map(tournaments.map((t) => [t.id, t]));
    return {
      items: page.rows.flatMap((row) => {
        const tournament = byId.get(row.id);
        return tournament
          ? [{ ...toSummary(tournament), distanceKm: Number(row.distance_km) }]
          : [];
      }),
      nextCursor: page.nextCursor,
    };
  }

  async detail(slug: string): Promise<TournamentDetail> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] } },
      include: {
        venue: true,
        organization: true,
        teams: {
          orderBy: [{ group: 'asc' }, { name: 'asc' }],
          take: MAX_TEAMS,
        },
        matches: {
          orderBy: [{ startsAt: 'asc' }, { field: 'asc' }],
          take: MAX_MATCHES,
        },
      },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const standings = computeStandings(
      t.teams.map((team) => ({
        id: team.code,
        name: team.name,
        group: team.group,
      })),
      t.matches
        .filter((m) => m.phase === 'groups')
        .map((m) => ({
          homeTeamId: m.homeTeamCode,
          awayTeamId: m.awayTeamCode,
          scoreHome: m.scoreHome,
          scoreAway: m.scoreAway,
          finished: m.status === 'FINISHED',
        })),
    );
    return {
      ...toSummary(t),
      teams: t.teams.map((team) => ({
        id: team.code,
        name: team.name,
        shortName: team.shortName,
        club: team.club,
        ...(team.group ? { group: team.group } : {}),
      })),
      matches: t.matches.map(toPublicMatch),
      standings,
    };
  }

  /**
   * Matchs d'une journée (heure de Paris), regroupés par créneau puis par
   * phase, avec les journées du tournoi pour naviguer. Sans `day` : la
   * journée en cours, sinon la prochaine, sinon la dernière. Une journée
   * sans match rend des créneaux vides (l'ancre reste valable).
   */
  async matchesByDay(slug: string, day?: string): Promise<DayMatches> {
    const tournamentId = await this.publicTournamentId(slug);
    const days = (
      await this.prisma.$queryRaw<{ day: string }[]>`
        SELECT DISTINCT to_char(starts_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS day
        FROM match
        WHERE tournament_id = ${tournamentId}
        ORDER BY day
        LIMIT ${MAX_DAYS}`
    ).map((row) => row.day);
    const today = parisDate(this.clock.now());
    const chosen =
      day ??
      (days.includes(today)
        ? today
        : (days.find((d) => d > today) ?? days.at(-1) ?? today));
    const matches = await this.prisma.match.findMany({
      where: {
        tournamentId,
        startsAt: {
          gte: parisDateTime(chosen, '00:00'),
          lt: parisDateTime(nextDate(chosen), '00:00'),
        },
      },
      orderBy: [
        { startsAt: 'asc' },
        { phase: 'asc' },
        { group: 'asc' },
        { field: 'asc' },
        { code: 'asc' },
      ],
      take: MAX_MATCHES,
    });
    const slots: DayMatches['slots'] = [];
    for (const match of matches) {
      const startsAt = toIso(match.startsAt);
      let slot = slots.at(-1);
      if (slot?.startsAt !== startsAt) {
        slot = { startsAt, phases: [] };
        slots.push(slot);
      }
      const phase = toPublicPhase(match.phase);
      let group = slot.phases.at(-1);
      if (group?.phase !== phase) {
        group = { phase, matches: [] };
        slot.phases.push(group);
      }
      group.matches.push(toPublicMatch(match));
    }
    return {
      day: chosen,
      days,
      previousDay: days.findLast((d) => d < chosen) ?? null,
      nextDay: days.find((d) => d > chosen) ?? null,
      slots,
    };
  }

  /**
   * Fil News paginé : posts du plus récent au plus ancien (publishedAt, id),
   * cartes sponsorisées intercalées ; la rotation des sponsors continue
   * d'une page à l'autre (son rang est dans le curseur).
   */
  async news(slug: string, query: PageQuery): Promise<Page<NewsItem>> {
    const after = query.cursor
      ? decodeCursor(query.cursor, 'news', newsCursor)
      : null;
    const tournamentId = await this.publicTournamentId(slug);
    const [rows, sponsors] = await Promise.all([
      this.prisma.post.findMany({
        where: {
          tournamentId,
          ...seekAfter(
            'publishedAt',
            'id',
            'desc',
            after ? { value: after[0], id: after[1] } : null,
          ),
        },
        orderBy: seekOrder('publishedAt', 'id', 'desc'),
        take: query.limit + 1,
        include: { options: { orderBy: { position: 'asc' } } },
      }),
      this.paidSponsors(tournamentId),
    ]);
    const feedSponsors = sponsors.filter((s) => s.tier !== 'FIELD');
    const rotation = after?.[2] ?? 0;
    const feed = composeFeed(
      rows.slice(0, query.limit),
      feedSponsors,
      rotation,
    );
    const shown = feed.filter((item) => item.type === 'sponsored').length;
    const page = takePage(rows, query.limit, (post) =>
      encodeCursor('news', [
        post.publishedAt.toISOString(),
        post.id,
        rotation + shown,
      ]),
    );
    const items = feed.map((item): NewsItem => {
      if (item.type === 'sponsored') {
        return { type: 'sponsored', sponsor: card(item.sponsor) };
      }
      const post = item.post;
      return {
        type: 'post',
        id: post.id,
        kind:
          post.kind === 'ANNOUNCEMENT'
            ? 'announcement'
            : post.kind === 'RESULT'
              ? 'result'
              : 'poll',
        publishedAt: toIso(post.publishedAt),
        title: post.title,
        body: post.body,
        ...(post.matchCode ? { matchId: post.matchCode } : {}),
        ...(post.kind === 'POLL'
          ? {
              poll: {
                options: post.options.map((o) => ({
                  id: o.id,
                  label: o.label,
                  votes: o.votes,
                })),
              },
            }
          : {}),
      };
    });
    return { items, nextCursor: page.nextCursor };
  }

  /** Sponsors affichés : bannière exclusive (Or), bandeau partagé (6 au plus), terrains. */
  async sponsors(slug: string): Promise<PublicSponsors> {
    const sponsors = await this.paidSponsors(
      await this.publicTournamentId(slug),
    );
    const gold = sponsors.find((s) => s.tier === 'GOLD');
    return {
      exclusive: gold ? card(gold) : null,
      rotation: sponsors
        .filter((s) => s.tier === 'SILVER' || s.tier === 'BRONZE')
        .slice(0, MAX_ROTATION)
        .map(card),
      // Par terrain (« Terrain 2 » avant « Terrain 10 ») : ordre stable.
      fields: sponsors
        .filter((s) => s.tier === 'FIELD' && s.field)
        .map((s) => ({ field: s.field!, sponsor: card(s) }))
        .sort((a, b) =>
          a.field.localeCompare(b.field, 'fr', { numeric: true }),
        ),
    };
  }

  /** Vote anonyme à un sondage ; l'appareil retient le vote pour ne pas le rejouer. */
  async vote(postId: string, optionId: string): Promise<PollResult> {
    const option = await this.prisma.pollOption.findFirst({
      where: {
        id: optionId,
        postId,
        post: {
          kind: 'POLL',
          tournament: { status: { in: [...PUBLIC_STATUSES] } },
        },
      },
    });
    if (!option) {
      throw new NotFoundException('Sondage introuvable.');
    }
    await this.prisma.pollOption.update({
      where: { id: optionId },
      data: { votes: { increment: 1 } },
    });
    const options = await this.prisma.pollOption.findMany({
      where: { postId },
      orderBy: { position: 'asc' },
    });
    return {
      options: options.map((o) => ({
        id: o.id,
        label: o.label,
        votes: o.votes,
      })),
    };
  }

  /**
   * Impression ou clic d'un sponsor payé, ajouté au cumul de l'heure. La
   * requête vérifie le sponsor puis dépose l'événement dans la file BullMQ,
   * traitée par le worker ; sans Redis, l'écriture se fait directement. Le
   * dédoublonnage par session se fait côté PWA (une impression par
   * emplacement et par session).
   */
  async recordAudience(event: AudienceEvent): Promise<void> {
    const sponsor = await this.prisma.tournamentSponsor.findFirst({
      where: { id: event.sponsorId, status: 'PAID' },
      select: { id: true },
    });
    if (!sponsor) {
      throw new NotFoundException('Sponsor introuvable.');
    }
    const hourBucket = new Date(this.clock.now());
    hourBucket.setUTCMinutes(0, 0, 0);
    const job: AudienceJob = {
      tournamentSponsorId: sponsor.id,
      placement: event.placement as Placement,
      kind: event.kind,
      hourBucket: hourBucket.toISOString(),
    };
    if (this.audienceQueue) {
      await this.audienceQueue.add('record', job);
    } else {
      await this.audienceWriter.apply(job);
    }
  }

  /** Fil du direct d'un match : événements rejoués, réactions, dernière mise à jour. */
  async matchFeed(slug: string, code: string): Promise<MatchFeed> {
    const matchId = await this.publicMatchId(slug, code);
    const [events, reactions] = await Promise.all([
      this.prisma.matchEvent.findMany({
        where: { matchId },
        orderBy: { seq: 'asc' },
        take: MAX_MATCH_EVENTS,
      }),
      this.reactionCounts(matchId),
    ]);
    const last = events.at(-1);
    return {
      events: replayFeed(events),
      reactions,
      updatedAt: last ? toIso(last.createdAt) : null,
    };
  }

  /** Réaction anonyme : la même réaction du même appareil ne compte qu'une fois. */
  async react(
    slug: string,
    code: string,
    input: ReactionInput,
  ): Promise<ReactionCounts> {
    const matchId = await this.publicMatchId(slug, code);
    await this.prisma.matchReaction.createMany({
      data: [{ matchId, kind: input.kind, deviceId: input.deviceId }],
      skipDuplicates: true,
    });
    return this.reactionCounts(matchId);
  }

  private async reactionCounts(matchId: string): Promise<ReactionCounts> {
    const groups = await this.prisma.matchReaction.groupBy({
      by: ['kind'],
      where: { matchId },
      _count: { _all: true },
    });
    const counts: ReactionCounts = { CLAP: 0, FIRE: 0, WOW: 0 };
    for (const group of groups) {
      counts[group.kind] = group._count._all;
    }
    return counts;
  }

  private async publicMatchId(slug: string, code: string): Promise<string> {
    const match = await this.prisma.match.findFirst({
      where: {
        code,
        tournament: { slug, status: { in: [...PUBLIC_STATUSES] } },
      },
      select: { id: true },
    });
    if (!match) {
      throw new NotFoundException('Match introuvable.');
    }
    return match.id;
  }

  private async publicTournamentId(slug: string): Promise<string> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] } },
      select: { id: true },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    return t.id;
  }

  private paidSponsors(tournamentId: string) {
    return this.prisma.tournamentSponsor.findMany({
      where: { tournamentId, status: 'PAID' },
      include: { sponsor: true },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      take: MAX_PAID_SPONSORS,
    });
  }
}

function card(s: {
  id: string;
  tier: string;
  sponsor: { name: string; website: string | null };
}): SponsorCard {
  return {
    id: s.id,
    name: s.sponsor.name,
    tier: s.tier as SponsorCard['tier'],
    ...(s.sponsor.website ? { website: s.sponsor.website } : {}),
  };
}

/** Match du contrat public (identifiants courts, phase en kebab-case). */
function toPublicMatch(m: Match): PublicMatch {
  return {
    id: m.code,
    phase: toPublicPhase(m.phase),
    ...(m.group ? { group: m.group } : {}),
    field: m.field,
    startsAt: toIso(m.startsAt),
    homeTeamId: m.homeTeamCode,
    awayTeamId: m.awayTeamCode,
    ...(m.homePlaceholder ? { homePlaceholder: m.homePlaceholder } : {}),
    ...(m.awayPlaceholder ? { awayPlaceholder: m.awayPlaceholder } : {}),
    scoreHome: m.scoreHome,
    scoreAway: m.scoreAway,
    status: m.status,
    ...(m.minute === null ? {} : { minute: m.minute }),
  };
}

/** Lendemain d'une journée (« 2026-11-09 » → « 2026-11-10 »). */
function nextDate(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, date! + 1))
    .toISOString()
    .slice(0, 10);
}
