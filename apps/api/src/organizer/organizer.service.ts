import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { keyset, type Page, type PageQuery } from '../common/pagination.js';
import { parisDate, parisDateTime } from '../common/paris-time.js';
import { insertWithUniqueSlug, slugify } from '../common/slug.js';
import type {
  TournamentFormat,
  TournamentStatus,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateTournament,
  OrganizerTournament,
  CreatePost,
  CreatedPost,
  InviteSponsor,
  OrganizerSponsors,
  SponsorRow,
  UpdateSponsor,
  Schedule,
  ScheduleResult,
} from './organizer.schemas.js';

const TIER_ORDER = { GOLD: 0, SILVER: 1, BRONZE: 2, FIELD: 3 } as const;

/**
 * Bornes de l'écran sponsors (non paginé) : les sponsors d'un tournoi sont
 * limités par les packs (4 au plus, leur inventaire), le carnet de
 * prospects du club par cette borne.
 */
export const MAX_TOURNAMENT_SPONSORS = 200;
export const MAX_PROSPECTS = 200;

const FORMATS: Record<CreateTournament['format'], TournamentFormat> = {
  'single-group': 'SINGLE_GROUP',
  'groups-knockout': 'GROUPS_KNOCKOUT',
  knockout: 'KNOCKOUT',
  swiss: 'SWISS',
};

/** Statut de la carte organisateur : brouillon, publié (avant ou après le jour J), en cours. */
function cardStatus(status: TournamentStatus): OrganizerTournament['status'] {
  if (status === 'DRAFT') {
    return 'DRAFT';
  }
  return status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PUBLISHED';
}

/**
 * Sponsors et annonces d'un tournoi, toujours lus et écrits dans le périmètre
 * de l'organisation de la personne : une ressource d'une autre organisation
 * répond 404, jamais 403 (plan, section 5).
 */
@Injectable()
export class OrganizerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async sponsors(
    organizationSlug: string,
    tournamentSlug: string,
  ): Promise<OrganizerSponsors> {
    const tournament = await this.ownTournament(
      organizationSlug,
      tournamentSlug,
    );
    const [packages, rows, audience, prospects] = await Promise.all([
      // Un pack par palier (contrainte unique) : 4 au plus.
      this.prisma.sponsorPackage.findMany({
        where: { tournamentId: tournament.id },
        take: Object.keys(TIER_ORDER).length,
      }),
      this.prisma.tournamentSponsor.findMany({
        where: { tournamentId: tournament.id },
        include: { sponsor: true },
        orderBy: { id: 'asc' },
        take: MAX_TOURNAMENT_SPONSORS,
      }),
      // Cumul de l'audience en base : les lignes horaires grandissent avec le temps.
      this.prisma.audienceHourly.groupBy({
        by: ['tournamentSponsorId'],
        where: { tournamentSponsor: { tournamentId: tournament.id } },
        _sum: { impressions: true, clicks: true },
      }),
      this.prisma.sponsor.findMany({
        where: {
          organizationId: tournament.organizationId,
          source: 'CLUB',
          tournaments: { none: { tournamentId: tournament.id } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: MAX_PROSPECTS,
      }),
    ]);
    const totals = new Map(
      audience.map((a) => [a.tournamentSponsorId, a._sum]),
    );
    return {
      packages: packages
        .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
        .map((p) => ({
          tier: p.tier,
          priceCents: p.priceCents,
          inventory: p.inventory,
          taken: rows.filter(
            (r) => r.tier === p.tier && r.status !== 'PROSPECT',
          ).length,
        })),
      sponsors: rows
        .map((r): SponsorRow => ({
          id: r.id,
          sponsorId: r.sponsorId,
          name: r.sponsor.name,
          ...(r.sponsor.email ? { email: r.sponsor.email } : {}),
          status: r.status,
          tier: r.tier,
          ...(r.field ? { field: r.field } : {}),
          impressions: totals.get(r.id)?.impressions ?? 0,
          clicks: totals.get(r.id)?.clicks ?? 0,
        }))
        .sort(
          (a, b) =>
            TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
            a.name.localeCompare(b.name, 'fr'),
        ),
      prospects: prospects.map((p) => ({
        id: p.id,
        name: p.name,
        ...(p.email ? { email: p.email } : {}),
      })),
    };
  }

  /**
   * Invite un sponsor à prendre un pack : prospect du club ou nouveau sponsor.
   * Refusé si le pack est épuisé. L'e-mail d'invitation partira du worker.
   */
  async invite(
    organizationSlug: string,
    tournamentSlug: string,
    input: InviteSponsor,
  ): Promise<SponsorRow> {
    const tournament = await this.ownTournament(
      organizationSlug,
      tournamentSlug,
    );
    return this.prisma.$transaction(async (tx) => {
      const pack = await tx.sponsorPackage.findUnique({
        where: {
          tournamentId_tier: { tournamentId: tournament.id, tier: input.tier },
        },
      });
      const taken = await tx.tournamentSponsor.count({
        where: {
          tournamentId: tournament.id,
          tier: input.tier,
          status: { not: 'PROSPECT' },
        },
      });
      if (!pack || taken >= pack.inventory) {
        throw new ConflictException('Ce pack est épuisé.');
      }
      const sponsor = input.sponsorId
        ? await tx.sponsor.findFirst({
            where: {
              id: input.sponsorId,
              organizationId: tournament.organizationId,
            },
          })
        : await tx.sponsor.create({
            data: {
              organizationId: tournament.organizationId,
              name: input.name!,
              email: input.email ?? null,
              source: 'TOURNAMENT',
            },
          });
      if (!sponsor) {
        throw new NotFoundException('Sponsor introuvable.');
      }
      const existing = await tx.tournamentSponsor.findUnique({
        where: {
          tournamentId_sponsorId: {
            tournamentId: tournament.id,
            sponsorId: sponsor.id,
          },
        },
      });
      if (existing) {
        throw new ConflictException('Ce sponsor est déjà sur le tournoi.');
      }
      const row = await tx.tournamentSponsor.create({
        data: {
          tournamentId: tournament.id,
          sponsorId: sponsor.id,
          status: 'INVITED',
          tier: input.tier,
          field: input.tier === 'FIELD' ? (input.field ?? null) : null,
          invitedAt: this.clock.now(),
        },
      });
      return {
        id: row.id,
        sponsorId: sponsor.id,
        name: sponsor.name,
        ...(sponsor.email ? { email: sponsor.email } : {}),
        status: row.status,
        tier: row.tier,
        ...(row.field ? { field: row.field } : {}),
        impressions: 0,
        clicks: 0,
      };
    });
  }

  /** Paiement reçu hors Stripe (espèces, chèque) ; Stripe le fera par webhook. */
  async updateSponsor(
    organizationSlug: string,
    id: string,
    input: UpdateSponsor,
  ): Promise<void> {
    const row = await this.prisma.tournamentSponsor.findFirst({
      where: { id, tournament: { organization: { slug: organizationSlug } } },
    });
    if (!row) {
      throw new NotFoundException('Sponsor introuvable.');
    }
    await this.prisma.tournamentSponsor.update({
      where: { id },
      data: {
        status: input.status,
        paidAt: input.status === 'PAID' ? this.clock.now() : null,
      },
    });
  }

  async createPost(
    organizationSlug: string,
    tournamentSlug: string,
    input: CreatePost,
  ): Promise<CreatedPost> {
    const tournament = await this.ownTournament(
      organizationSlug,
      tournamentSlug,
    );
    const post = await this.prisma.post.create({
      data: {
        tournamentId: tournament.id,
        kind: input.kind === 'poll' ? 'POLL' : 'ANNOUNCEMENT',
        title: input.title,
        body: input.body,
        publishedAt: this.clock.now(),
        options:
          input.kind === 'poll' && input.options
            ? {
                create: input.options.map((label, position) => ({
                  label,
                  position,
                })),
              }
            : undefined,
      },
    });
    return { id: post.id, publishedAt: post.publishedAt.toISOString() };
  }

  /**
   * Écran 01 : les tournois de l'organisation, les plus proches en premier,
   * paginés sur (startsAt, id).
   */
  async tournaments(
    organizationSlug: string,
    query: PageQuery,
  ): Promise<Page<OrganizerTournament>> {
    const page = keyset(
      {
        scope: 'organizer:tournaments',
        key: 'startsAt',
        kind: 'date',
        direction: 'asc',
      },
      query,
    );
    const rows = await this.prisma.tournament.findMany({
      where: {
        organization: { slug: organizationSlug },
        status: { not: 'ARCHIVED' },
        ...page.where,
      },
      include: { venue: true },
      orderBy: page.orderBy,
      take: page.take,
    });
    return page.finish(rows, (t) => ({
      slug: t.slug,
      name: t.name,
      status: cardStatus(t.status),
      startsAt: t.startsAt.toISOString(),
      city: t.venue.city,
      teamCount: t.teamCount,
      maxTeams: t.maxTeams,
      sport: t.sport,
      venueName: t.venue.name,
      categories: t.categories,
      fields: t.fieldCount,
    }));
  }

  /**
   * Publie le brouillon de l'assistant : inscriptions ouvertes, lieu repris
   * s'il existe déjà dans l'organisation (même nom, même ville), slug unique.
   */
  async createTournament(
    organizationSlug: string,
    input: CreateTournament,
  ): Promise<OrganizerTournament> {
    const organization = await this.prisma.organization.findUnique({
      where: { slug: organizationSlug },
      select: { id: true },
    });
    if (!organization) {
      throw new NotFoundException('Organisation introuvable.');
    }
    const startsAt = parisDateTime(input.date, input.startTime);
    const endsAt = parisDateTime(input.date, input.endTime);

    const base = slugify(input.name) || 'tournoi';
    const taken = await this.prisma.tournament.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });
    // Toute la transaction est rejouée sur un slug pris entre-temps : le lieu
    // créé par la tentative interrompue est annulé avec elle.
    const created = await insertWithUniqueSlug(
      base,
      taken.map((t) => t.slug),
      (slug) =>
        this.prisma.$transaction(async (tx) => {
          const venue =
            (await tx.venue.findFirst({
              where: {
                organizationId: organization.id,
                name: input.venueName,
                city: input.city,
              },
            })) ??
            (await tx.venue.create({
              data: {
                organizationId: organization.id,
                name: input.venueName,
                city: input.city,
                lat: input.lat,
                lng: input.lng,
                outdoor: input.outdoor,
              },
            }));
          return tx.tournament.create({
            data: {
              organizationId: organization.id,
              venueId: venue.id,
              slug,
              name: input.name,
              sport: input.sport,
              startsAt,
              endsAt,
              categories: input.categories,
              maxTeams: input.maxTeams,
              feeCents: Math.round(input.feeEuros * 100),
              status: 'REGISTRATION_OPEN',
              format: FORMATS[input.format],
              fieldCount: input.fields,
              matchMinutes: input.matchMinutes,
              breakMinutes: input.breakMinutes,
              registrationDeadline: new Date(
                `${input.registrationDeadline}T00:00:00Z`,
              ),
            },
            include: { venue: true },
          });
        }),
    );

    return {
      slug: created.slug,
      name: created.name,
      status: cardStatus(created.status),
      startsAt: created.startsAt.toISOString(),
      city: created.venue.city,
      teamCount: created.teamCount,
      maxTeams: created.maxTeams,
      sport: created.sport,
      venueName: created.venue.name,
      categories: created.categories,
      fields: created.fieldCount,
    };
  }

  private async ownTournament(
    organizationSlug: string,
    tournamentSlug: string,
  ) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug: tournamentSlug, organization: { slug: organizationSlug } },
      select: { id: true, organizationId: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    return tournament;
  }

  /**
   * Publie le planning : seuls les matchs encore à venir bougent ; un match
   * inconnu du tournoi répond 404, un match commencé ou terminé 409.
   */
  async saveSchedule(
    organizationSlug: string,
    slug: string,
    input: Schedule,
  ): Promise<ScheduleResult> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
      include: { matches: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const byCode = new Map(tournament.matches.map((m) => [m.code, m]));
    const changes: { id: string; field: string; startsAt: Date }[] = [];
    for (const slot of input.slots) {
      const match = byCode.get(slot.match);
      if (!match) {
        throw new NotFoundException(`Match ${slot.match} introuvable.`);
      }
      const hh = String(Math.floor(slot.minutes / 60)).padStart(2, '0');
      const mm = String(slot.minutes % 60).padStart(2, '0');
      const startsAt = parisDateTime(parisDate(match.startsAt), `${hh}:${mm}`);
      if (
        startsAt.getTime() === match.startsAt.getTime() &&
        slot.field === match.field
      ) {
        continue;
      }
      if (match.status !== 'SCHEDULED') {
        throw new ConflictException(
          `Le match ${slot.match} a commencé : il ne change plus de créneau.`,
        );
      }
      changes.push({ id: match.id, field: slot.field, startsAt });
    }
    await this.prisma.$transaction(
      changes.map(({ id, field, startsAt }) =>
        this.prisma.match.update({ where: { id }, data: { field, startsAt } }),
      ),
    );
    return { updated: changes.length };
  }
}
