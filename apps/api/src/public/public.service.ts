import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { computeStandings } from '@dmoh/tournoi-connect-engine';
import {
  AudienceWriter,
  type AudienceJob,
} from '../audience/audience-writer.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Placement } from '../generated/prisma/enums.js';
import { MediaService, VISIBLE_PHOTO } from '../media/media.service.js';
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
  NearbyTournament,
  SearchQuery,
  Sitemap,
  TournamentDetail,
} from './public.schemas.js';
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
const MAX_RESULTS = 50;
const MAX_ROTATION = 6;

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audienceWriter: AudienceWriter,
    private readonly media: MediaService,
    @Optional()
    @InjectQueue(AUDIENCE_QUEUE)
    private readonly audienceQueue?: Queue<AudienceJob>,
  ) {}

  /**
   * Tournois en cours ou à venir dans le rayon, triés par distance puis date.
   * Distance haversine en SQL, préfiltrée par une boîte lat/lng indexée ;
   * PostGIS (ST_DWithin, GiST) remplacera ce calcul (plan, section 4).
   */
  async search(query: SearchQuery): Promise<NearbyTournament[]> {
    const dLat = query.radiusKm / KM_PER_DEGREE_LAT;
    const dLng =
      query.radiusKm /
      (KM_PER_DEGREE_LAT * Math.cos((query.lat * Math.PI) / 180));
    const rows = await this.prisma.$queryRaw<
      { id: string; distance_km: number }[]
    >`
      SELECT t.id, d.distance_km
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
        AND t.hidden_at IS NULL
        AND t.ends_at >= ${this.clock.now()}
        AND v.lat BETWEEN ${query.lat - dLat} AND ${query.lat + dLat}
        AND v.lng BETWEEN ${query.lng - dLng} AND ${query.lng + dLng}
        AND (${query.sport ?? null}::text IS NULL OR t.sport::text = ${query.sport ?? null})
        AND d.distance_km <= ${query.radiusKm}
      ORDER BY d.distance_km, t.starts_at
      LIMIT ${MAX_RESULTS}`;

    const tournaments = await this.prisma.tournament.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: { venue: true, organization: true },
    });
    const byId = new Map(tournaments.map((t) => [t.id, t]));
    return rows.flatMap((row) => {
      const tournament = byId.get(row.id);
      return tournament
        ? [{ ...toSummary(tournament), distanceKm: Number(row.distance_km) }]
        : [];
    });
  }

  /** Tournois publiés et non masqués, les plus récents d'abord (50 000 au plus). */
  async sitemap(): Promise<Sitemap> {
    const tournaments = await this.prisma.tournament.findMany({
      where: { status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      select: { slug: true, endsAt: true },
      orderBy: { startsAt: 'desc' },
      take: 50_000,
    });
    return {
      tournaments: tournaments.map((t) => ({
        slug: t.slug,
        endsAt: t.endsAt.toISOString(),
      })),
    };
  }

  async detail(slug: string): Promise<TournamentDetail> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      include: {
        venue: true,
        organization: true,
        teams: { orderBy: [{ group: 'asc' }, { name: 'asc' }] },
        matches: { orderBy: [{ startsAt: 'asc' }, { field: 'asc' }] },
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
      matches: t.matches.map((m) => ({
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
      })),
      standings,
    };
  }

  /** Fil News : posts du plus récent au plus ancien, cartes sponsorisées intercalées. */
  async news(slug: string): Promise<NewsItem[]> {
    const tournamentId = await this.publicTournamentId(slug);
    const [posts, sponsors] = await Promise.all([
      this.prisma.post.findMany({
        where: { tournamentId, hiddenAt: null },
        orderBy: { publishedAt: 'desc' },
        take: 50,
        include: { options: { orderBy: { position: 'asc' } } },
      }),
      this.paidSponsors(tournamentId),
    ]);
    const feedSponsors = sponsors.filter((s) => s.tier !== 'FIELD');
    return composeFeed(posts, feedSponsors).map((item): NewsItem => {
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
      fields: sponsors
        .filter((s) => s.tier === 'FIELD' && s.field)
        .map((s) => ({ field: s.field!, sponsor: card(s) })),
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
          hiddenAt: null,
          tournament: { status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
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
      }),
      this.reactionCounts(matchId),
    ]);
    const last = events.at(-1);
    const photoIds = events.flatMap((e) => (e.photoId ? [e.photoId] : []));
    const photos = new Map(
      photoIds.length === 0
        ? []
        : (
            await this.prisma.photo.findMany({
              where: { id: { in: photoIds }, matchId, ...VISIBLE_PHOTO },
            })
          ).map((p) => [
            p.id,
            {
              id: p.id,
              url: this.media.url(p.storageKey),
              width: p.width,
              height: p.height,
            },
          ]),
    );
    return {
      // Un événement dont la photo est retirée ou masquée disparaît du fil.
      events: replayFeed(events).flatMap(({ photoId, ...event }) => {
        if (!photoId) {
          return [event];
        }
        const photo = photos.get(photoId);
        return photo ? [{ ...event, photo }] : [];
      }),
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
        tournament: {
          slug,
          status: { in: [...PUBLIC_STATUSES] },
          hiddenAt: null,
        },
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
      where: { slug, status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
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
      orderBy: { paidAt: 'asc' },
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
