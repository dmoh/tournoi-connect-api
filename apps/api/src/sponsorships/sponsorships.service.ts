import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { StripeClient } from '../payments/stripe-client.js';
import { HOLD_MINUTES, registrationQuote } from '../registrations/pricing.js';
import { STRIPE } from '../registrations/registrations.tokens.js';
import { hashToken, SponsorInvites } from './sponsor-invites.service.js';
import type { InviteLink, SponsorInvitation } from './sponsorships.schemas.js';

const TIER_NAME = {
  GOLD: 'Or',
  SILVER: 'Argent',
  BRONZE: 'Bronze',
  FIELD: 'Terrain',
} as const;

/**
 * Paiement en ligne d'un pack sponsor : page publique ouverte par le lien
 * personnel, puis Stripe Checkout sur le compte du club. Le sponsor paie le
 * prix du pack plus 7 % + 0,50 € de frais de service, comme une inscription.
 */
@Injectable()
export class SponsorshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly invites: SponsorInvites,
    private readonly config: ConfigService<Env, true>,
    @Inject(STRIPE) private readonly stripe: StripeClient,
  ) {}

  async view(token: string): Promise<SponsorInvitation> {
    const row = await this.byToken(token);
    const price =
      row.tournament.packages.find((p) => p.tier === row.tier)?.priceCents ?? 0;
    const quote = registrationQuote(price);
    return {
      tournament: {
        slug: row.tournament.slug,
        name: row.tournament.name,
        startsAt: row.tournament.startsAt.toISOString(),
        city: row.tournament.venue.city,
      },
      club: row.tournament.organization.name,
      sponsor: { name: row.sponsor.name, email: row.sponsor.email },
      tier: row.tier,
      field: row.field,
      // Pack payé : le montant réellement réglé, même si le prix a changé depuis.
      priceCents:
        row.status === 'PAID' && row.amountCents !== null
          ? row.amountCents
          : quote.feeCents,
      serviceFeeCents:
        row.status === 'PAID' && row.serviceFeeCents !== null
          ? row.serviceFeeCents
          : quote.serviceFeeCents,
      totalCents:
        row.status === 'PAID' && row.amountCents !== null
          ? row.amountCents + (row.serviceFeeCents ?? 0)
          : quote.totalCents,
      status: row.status === 'PAID' ? 'PAID' : 'INVITED',
      paidAt: row.paidAt?.toISOString() ?? null,
      paymentsReady: this.ready(row.tournament.organization),
    };
  }

  /**
   * Page de paiement Stripe du pack (409 déjà payé, 503 si le club ne peut
   * pas encaisser en ligne). Une nouvelle page remplace la précédente.
   */
  async checkout(token: string, email: string): Promise<{ url: string }> {
    const row = await this.byToken(token);
    if (row.status === 'PAID') {
      throw new ConflictException(
        'Ce pack est déjà payé. Merci pour votre soutien !',
      );
    }
    const organization = row.tournament.organization;
    if (!this.ready(organization)) {
      throw new ServiceUnavailableException(
        'Le club n’encaisse pas encore en ligne : réglez-le directement auprès de lui.',
      );
    }
    const price = row.tournament.packages.find(
      (p) => p.tier === row.tier,
    )?.priceCents;
    if (!price) {
      throw new ConflictException('Ce pack n’est plus proposé.');
    }
    const quote = registrationQuote(price);
    const expiresAt = new Date(
      this.clock.now().getTime() + HOLD_MINUTES * 60_000,
    );
    const back = this.appUrl(`/sponsor/${encodeURIComponent(token)}`);
    const session = await this.stripe.createCheckoutSession({
      destination: organization.stripeAccountId!,
      applicationFeeCents: quote.serviceFeeCents,
      lines: [
        {
          name: `Pack ${TIER_NAME[row.tier]}${row.field ? ` (${row.field})` : ''} · ${row.tournament.name}`,
          amountCents: quote.feeCents,
        },
        {
          name: 'Frais de service Tournoi Connect',
          amountCents: quote.serviceFeeCents,
        },
      ],
      customerEmail: email,
      successUrl: `${back}?paid=1`,
      cancelUrl: back,
      expiresAt,
      metadata: { sponsorship: row.id, tournament: row.tournament.slug },
      idempotencyKey: `sponsor-checkout-${row.id}-${expiresAt.getTime()}`,
    });
    await this.prisma.tournamentSponsor.update({
      where: { id: row.id },
      data: {
        checkoutSessionId: session.id,
        amountCents: quote.feeCents,
        serviceFeeCents: quote.serviceFeeCents,
      },
    });
    return { url: session.url };
  }

  /** Lien de paiement d'un sponsor du club (renvoyé par email s'il a une adresse). */
  async inviteLink(organizationSlug: string, id: string): Promise<InviteLink> {
    const row = await this.prisma.tournamentSponsor.findFirst({
      where: { id, tournament: { organization: { slug: organizationSlug } } },
      select: { id: true, status: true },
    });
    if (!row) {
      throw new NotFoundException('Sponsor introuvable.');
    }
    if (row.status !== 'INVITED') {
      throw new ConflictException(
        'Seul un sponsor invité, pas encore payé, reçoit un lien.',
      );
    }
    return this.invites.issue(row.id);
  }

  private ready(organization: {
    stripeAccountId: string | null;
    stripeChargesEnabled: boolean;
  }) {
    return (
      this.stripe.enabled &&
      !!organization.stripeAccountId &&
      organization.stripeChargesEnabled
    );
  }

  private async byToken(token: string) {
    const row = token
      ? await this.prisma.tournamentSponsor.findUnique({
          where: { inviteTokenHash: hashToken(token) },
          include: {
            sponsor: true,
            tournament: {
              include: { organization: true, venue: true, packages: true },
            },
          },
        })
      : null;
    if (!row || row.status === 'PROSPECT' || row.tournament.hiddenAt) {
      throw new NotFoundException('Lien de paiement invalide ou remplacé.');
    }
    return row;
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
