import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth.guard.js';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Registration, Tournament } from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import { registrationConfirmedMail } from '../mail/templates.js';
import { toSummary } from '../public/public-mapping.js';
import { StripeClient, StripeError } from '../payments/stripe-client.js';
import {
  HOLD_MINUTES,
  registrationQuote,
  shortName,
  teamCodeBase,
} from './pricing.js';
import type {
  OrganizerRegistration,
  PaymentsStatus,
  Register,
  RegistrationInvite,
  RegistrationView,
} from './registrations.schemas.js';
import { STRIPE } from './registrations.tokens.js';

type Tx = Prisma.TransactionClient;
type StoredPlayer = { firstName: string; lastName: string; number: string };

const DAY_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * Inscriptions d'équipe par leur responsable : place tenue 31 minutes pendant
 * le paiement Stripe Checkout (argent versé au compte Connect du club, frais
 * de service à la plateforme), liste d'attente quand le tournoi est complet,
 * équipe créée à la confirmation.
 */
@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger('Inscriptions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
    @Inject(STRIPE) private readonly stripe: StripeClient,
  ) {}

  async invite(code: string): Promise<RegistrationInvite> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { slug: code },
      include: { venue: true, organization: true },
    });
    if (
      !tournament ||
      tournament.status === 'DRAFT' ||
      tournament.status === 'ARCHIVED'
    ) {
      throw new NotFoundException('Lien d’inscription inconnu.');
    }
    const now = this.clock.now();
    return {
      code,
      tournament: toSummary(tournament),
      quote: registrationQuote(tournament.feeCents),
      open: this.isOpen(tournament, now),
      full:
        (await this.occupied(
          this.prisma,
          tournament.id,
          tournament.teamCount,
          now,
        )) >= tournament.maxTeams,
      paymentsReady:
        tournament.feeCents === 0 ||
        (this.stripe.enabled && tournament.organization.stripeChargesEnabled),
    };
  }

  /** Inscrit l'équipe ; la même clé d'idempotence rend la même inscription. */
  async register(
    code: string,
    user: AuthUser,
    input: Register,
    idempotencyKey: string,
  ): Promise<RegistrationView> {
    const existing = await this.prisma.registration.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.managerId !== user.id) {
        throw new ConflictException('Clé d’idempotence déjà utilisée.');
      }
      return this.view(existing.id, user.id);
    }
    const tournament = await this.prisma.tournament.findUnique({
      where: { slug: code },
      include: { organization: true },
    });
    const now = this.clock.now();
    if (
      !tournament ||
      tournament.status === 'DRAFT' ||
      tournament.status === 'ARCHIVED'
    ) {
      throw new NotFoundException('Lien d’inscription inconnu.');
    }
    if (!this.isOpen(tournament, now)) {
      throw new ConflictException(
        'Les inscriptions de ce tournoi sont fermées.',
      );
    }
    const paid = tournament.feeCents > 0;
    if (
      paid &&
      !(this.stripe.enabled && tournament.organization.stripeChargesEnabled)
    ) {
      throw new ServiceUnavailableException(
        'Le club n’a pas encore activé les paiements en ligne. Réessayez plus tard.',
      );
    }
    const manager = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const quote = registrationQuote(tournament.feeCents);

    // Verrou du tournoi : deux inscriptions simultanées ne prennent pas la même dernière place.
    const registration = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${tournament.id} FOR UPDATE`;
      const fresh = await tx.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
      });
      const full =
        (await this.occupied(tx, fresh.id, fresh.teamCount, now)) >=
        fresh.maxTeams;
      const created = await tx.registration.create({
        data: {
          tournamentId: tournament.id,
          managerId: user.id,
          teamName: input.teamName,
          club: input.club,
          managerName: input.managerName,
          phone: input.phone,
          players: input.players,
          status: full ? 'WAITLISTED' : paid ? 'PENDING_PAYMENT' : 'CONFIRMED',
          ...quote,
          idempotencyKey,
          ...(paid && !full
            ? { expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000) }
            : {}),
          createdAt: now,
        },
      });
      if (created.status === 'CONFIRMED') {
        await this.createTeam(tx, fresh, created);
      }
      return created;
    });

    if (registration.status === 'CONFIRMED') {
      await this.mailConfirmation(registration.id);
    }
    if (registration.status === 'PENDING_PAYMENT') {
      await this.openCheckout(registration, tournament, manager.email);
    }
    return this.view(registration.id, user.id);
  }

  async mine(userId: string): Promise<RegistrationView[]> {
    const rows = await this.prisma.registration.findMany({
      where: { managerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.view(r.id, userId)));
  }

  async view(id: string, userId: string): Promise<RegistrationView> {
    const registration = await this.prisma.registration.findFirst({
      where: { id, managerId: userId },
      include: { tournament: true },
    });
    if (!registration) {
      throw new NotFoundException('Inscription introuvable.');
    }
    const now = this.clock.now();
    const status =
      registration.status === 'PENDING_PAYMENT' &&
      registration.expiresAt &&
      registration.expiresAt <= now
        ? 'EXPIRED'
        : registration.status;
    const waitlistPosition =
      status === 'WAITLISTED'
        ? (await this.prisma.registration.count({
            where: {
              tournamentId: registration.tournamentId,
              status: 'WAITLISTED',
              createdAt: { lt: registration.createdAt },
            },
          })) + 1
        : undefined;
    return {
      orderId: registration.id,
      code: registration.tournament.slug,
      tournamentSlug: registration.tournament.slug,
      tournamentName: registration.tournament.name,
      startsAt: registration.tournament.startsAt.toISOString(),
      teamName: registration.teamName,
      status,
      quote: {
        feeCents: registration.feeCents,
        serviceFeeCents: registration.serviceFeeCents,
        totalCents: registration.totalCents,
      },
      ...(waitlistPosition ? { waitlistPosition } : {}),
      ...(status === 'PENDING_PAYMENT' && registration.checkoutUrl
        ? { checkoutUrl: registration.checkoutUrl }
        : {}),
      ...(status === 'PENDING_PAYMENT' && registration.expiresAt
        ? { expiresAt: registration.expiresAt.toISOString() }
        : {}),
      createdAt: registration.createdAt.toISOString(),
    };
  }

  /** Reprend un paiement dont la place a expiré, s'il reste une place. */
  async retryCheckout(id: string, userId: string): Promise<RegistrationView> {
    const now = this.clock.now();
    const registration = await this.prisma.registration.findFirst({
      where: { id, managerId: userId },
      include: {
        tournament: { include: { organization: true } },
        manager: true,
      },
    });
    if (!registration) {
      throw new NotFoundException('Inscription introuvable.');
    }
    const expired =
      registration.status === 'EXPIRED' ||
      (registration.status === 'PENDING_PAYMENT' &&
        registration.expiresAt !== null &&
        registration.expiresAt <= now);
    if (!expired) {
      return this.view(id, userId);
    }
    const { tournament } = registration;
    if (!this.isOpen(tournament, now)) {
      throw new ConflictException(
        'Les inscriptions de ce tournoi sont fermées.',
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${tournament.id} FOR UPDATE`;
      const fresh = await tx.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
      });
      const full =
        (await this.occupied(tx, fresh.id, fresh.teamCount, now)) >=
        fresh.maxTeams;
      return tx.registration.update({
        where: { id },
        data: full
          ? {
              status: 'WAITLISTED',
              expiresAt: null,
              checkoutSessionId: null,
              checkoutUrl: null,
            }
          : {
              status: 'PENDING_PAYMENT',
              expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
              checkoutSessionId: null,
              checkoutUrl: null,
            },
      });
    });
    if (updated.status === 'PENDING_PAYMENT') {
      await this.openCheckout(updated, tournament, registration.manager!.email);
    }
    return this.view(id, userId);
  }

  /** Paiement reçu (webhook checkout.session.completed). */
  async confirmPayment(
    sessionId: string,
    paymentIntentId: string | null,
  ): Promise<void> {
    const confirmed = await this.prisma.$transaction(async (tx) => {
      const registration = await tx.registration.findUnique({
        where: { checkoutSessionId: sessionId },
      });
      if (!registration || registration.status === 'CONFIRMED') {
        return null;
      }
      await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${registration.tournamentId} FOR UPDATE`;
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: registration.tournamentId },
      });
      const updated = await tx.registration.update({
        where: { id: registration.id },
        data: {
          status: 'CONFIRMED',
          paidAt: this.clock.now(),
          paymentIntentId,
          checkoutUrl: null,
        },
      });
      await this.createTeam(tx, tournament, updated);
      return updated;
    });
    if (confirmed) {
      await this.mailConfirmation(confirmed.id);
    }
  }

  /** Session de paiement expirée : la place est rendue. */
  async expireCheckout(sessionId: string): Promise<void> {
    await this.prisma.registration.updateMany({
      where: { checkoutSessionId: sessionId, status: 'PENDING_PAYMENT' },
      data: { status: 'EXPIRED', checkoutUrl: null },
    });
  }

  /** Compte Stripe mis à jour (webhook account.updated). */
  async accountUpdated(
    accountId: string,
    chargesEnabled: boolean,
  ): Promise<void> {
    await this.prisma.organization.updateMany({
      where: { stripeAccountId: accountId },
      data: { stripeChargesEnabled: chargesEnabled },
    });
  }

  async organizerRegistrations(
    organizationSlug: string,
    slug: string,
  ): Promise<OrganizerRegistration[]> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const now = this.clock.now();
    const rows = await this.prisma.registration.findMany({
      where: { tournamentId: tournament.id },
      include: { manager: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      teamName: r.teamName,
      club: r.club,
      managerName: r.managerName,
      email: r.manager?.email ?? null,
      phone: r.phone,
      players: Array.isArray(r.players) ? r.players.length : 0,
      status:
        r.status === 'PENDING_PAYMENT' && r.expiresAt && r.expiresAt <= now
          ? 'EXPIRED'
          : r.status,
      totalCents: r.totalCents,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async paymentsStatus(organizationSlug: string): Promise<PaymentsStatus> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    });
    let chargesEnabled = organization.stripeChargesEnabled;
    // Retour de l'activation : Stripe peut avoir validé le compte avant son webhook.
    if (
      organization.stripeAccountId &&
      !chargesEnabled &&
      this.stripe.enabled
    ) {
      try {
        const account = await this.stripe.retrieveAccount(
          organization.stripeAccountId,
        );
        chargesEnabled = account.charges_enabled;
        if (chargesEnabled) {
          await this.accountUpdated(organization.stripeAccountId, true);
        }
      } catch (error) {
        this.logger.warn(
          `Compte Stripe illisible : ${(error as Error).message}`,
        );
      }
    }
    return {
      available: this.stripe.enabled,
      connected: organization.stripeAccountId !== null,
      chargesEnabled,
    };
  }

  /** Lien d'activation des paiements du club (crée le compte Express au besoin). */
  async onboarding(
    organizationSlug: string,
    user: AuthUser,
  ): Promise<{ url: string }> {
    if (!this.stripe.enabled) {
      throw new ServiceUnavailableException(
        'Paiements non configurés sur la plateforme.',
      );
    }
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    });
    let accountId = organization.stripeAccountId;
    try {
      if (!accountId) {
        const owner = await this.prisma.user.findUniqueOrThrow({
          where: { id: user.id },
        });
        const account = await this.stripe.createAccount({
          email: owner.email,
          clubName: organization.name,
          clubSlug: organization.slug,
        });
        accountId = account.id;
        await this.prisma.organization.update({
          where: { id: organization.id },
          data: { stripeAccountId: accountId },
        });
      }
      return await this.stripe.accountLink(
        accountId,
        this.appUrl('/organizer/payments?stripe=refresh'),
        this.appUrl('/organizer/payments?stripe=return'),
      );
    } catch (error) {
      throw this.stripeFailure(error);
    }
  }

  private async openCheckout(
    registration: Registration,
    tournament: Tournament,
    email: string,
  ): Promise<void> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: tournament.organizationId },
    });
    try {
      const session = await this.stripe.createCheckoutSession({
        destination: organization.stripeAccountId!,
        applicationFeeCents: registration.serviceFeeCents,
        lines: [
          {
            name: `Inscription ${registration.teamName} · ${tournament.name}`,
            amountCents: registration.feeCents,
          },
          {
            name: 'Frais de service Tournoi Connect',
            amountCents: registration.serviceFeeCents,
          },
        ],
        customerEmail: email,
        successUrl: this.appUrl(
          `/join/${encodeURIComponent(tournament.slug)}/confirmation?order=${registration.id}`,
        ),
        cancelUrl: this.appUrl(
          `/join/${encodeURIComponent(tournament.slug)}?order=${registration.id}`,
        ),
        expiresAt: registration.expiresAt!,
        metadata: {
          registration: registration.id,
          tournament: tournament.slug,
        },
        idempotencyKey: `checkout-${registration.id}-${registration.expiresAt!.getTime()}`,
      });
      await this.prisma.registration.update({
        where: { id: registration.id },
        data: { checkoutSessionId: session.id, checkoutUrl: session.url },
      });
    } catch (error) {
      // Sans page de paiement, la place n'est pas tenue.
      await this.prisma.registration.update({
        where: { id: registration.id },
        data: { status: 'EXPIRED' },
      });
      throw this.stripeFailure(error);
    }
  }

  /** Places prises : équipes inscrites et paiements en cours non expirés. */
  private async occupied(
    db: Tx | PrismaService,
    tournamentId: string,
    teamCount: number,
    now: Date,
  ): Promise<number> {
    const holding = await db.registration.count({
      where: {
        tournamentId,
        status: 'PENDING_PAYMENT',
        expiresAt: { gt: now },
      },
    });
    return teamCount + holding;
  }

  private isOpen(tournament: Tournament, now: Date): boolean {
    if (tournament.status !== 'REGISTRATION_OPEN') {
      return false;
    }
    // Clôture : jusqu'à la fin du jour indiqué.
    return (
      !tournament.registrationDeadline ||
      now.getTime() <
        tournament.registrationDeadline.getTime() + 24 * 60 * 60 * 1000
    );
  }

  private async createTeam(
    tx: Tx,
    tournament: Tournament,
    registration: Registration,
  ): Promise<void> {
    const base = teamCodeBase(registration.teamName);
    const taken = new Set(
      (
        await tx.team.findMany({
          where: { tournamentId: tournament.id, code: { startsWith: base } },
          select: { code: true },
        })
      ).map((t) => t.code),
    );
    let code = base;
    for (let n = 2; taken.has(code); n += 1) {
      code = `${base}${n}`;
    }
    const players = (registration.players as StoredPlayer[]).map((p, i) => ({
      number: Number(p.number) || i + 1,
      name: `${p.firstName} ${p.lastName}`.trim(),
    }));
    // Numéros en double ou absents : renumérotés à la suite.
    const used = new Set<number>();
    const unique = players.map((p) => {
      let number = p.number;
      while (used.has(number)) {
        number += 100;
      }
      used.add(number);
      return { ...p, number };
    });
    const team = await tx.team.create({
      data: {
        tournamentId: tournament.id,
        code,
        name: registration.teamName,
        shortName: shortName(registration.teamName),
        club: registration.club || registration.teamName,
        players: { create: unique },
      },
    });
    await tx.registration.update({
      where: { id: registration.id },
      data: { teamId: team.id },
    });
    await tx.tournament.update({
      where: { id: tournament.id },
      data: { teamCount: { increment: 1 } },
    });
  }

  private async mailConfirmation(registrationId: string): Promise<void> {
    const registration = await this.prisma.registration.findUniqueOrThrow({
      where: { id: registrationId },
      include: { tournament: true, manager: true },
    });
    // Compte supprimé entre le paiement et sa confirmation : personne à prévenir.
    if (!registration.manager) {
      return;
    }
    await this.mailer.send(
      registrationConfirmedMail(registration.manager.email, {
        team: registration.teamName,
        tournament: registration.tournament.name,
        date: DAY_FORMAT.format(registration.tournament.startsAt),
        url: this.appUrl(`/t/${registration.tournament.slug}`),
      }),
    );
  }

  private stripeFailure(error: unknown): HttpException {
    if (error instanceof StripeError) {
      return new HttpException(
        `Paiement indisponible : ${error.message}`,
        error.status === 503
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.BAD_GATEWAY,
      );
    }
    return new HttpException('Paiement indisponible.', HttpStatus.BAD_GATEWAY);
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
