import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreatePost,
  CreatedPost,
  InviteSponsor,
  OrganizerSponsors,
  SponsorRow,
  UpdateSponsor,
} from './organizer.schemas.js';

const TIER_ORDER = { GOLD: 0, SILVER: 1, BRONZE: 2, FIELD: 3 } as const;

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
    const [packages, rows, prospects] = await Promise.all([
      this.prisma.sponsorPackage.findMany({
        where: { tournamentId: tournament.id },
      }),
      this.prisma.tournamentSponsor.findMany({
        where: { tournamentId: tournament.id },
        include: { sponsor: true, audience: true },
      }),
      this.prisma.sponsor.findMany({
        where: {
          organizationId: tournament.organizationId,
          source: 'CLUB',
          tournaments: { none: { tournamentId: tournament.id } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
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
          impressions: r.audience.reduce((sum, a) => sum + a.impressions, 0),
          clicks: r.audience.reduce((sum, a) => sum + a.clicks, 0),
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
}
