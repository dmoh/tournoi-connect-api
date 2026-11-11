import {
  BadGatewayException,
  ConflictException,
  HttpException,
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
import {
  registrationConfirmedMail,
  registrationRefundedMail,
} from '../mail/templates.js';
import { toSummary } from '../public/public-mapping.js';
import {
  CURRENCY,
  StripeClient,
  StripeError,
} from '../payments/stripe-client.js';
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

/** Événement du webhook Stripe, signature vérifiée. */
export interface StripeEvent {
  id: string;
  type: string;
  /** Création chez Stripe (secondes Unix), si fournie. */
  created: number | null;
  object: Record<string, unknown>;
}

/** Session Checkout payée, telle que Stripe la décrit. */
interface PaidSession {
  id: string;
  paymentIntent: string | null;
  amountTotal: unknown;
  currency: unknown;
  livemode: unknown;
  /** Métadonnée « registration » posée à la création de la session. */
  registrationId: string | null;
}

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const EURO_FORMAT = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

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

  /**
   * Événement Stripe signé. Il est enregistré dans la même transaction que
   * son effet : un renvoi du même identifiant (relance de Stripe, rejeu dans
   * la fenêtre de signature) est sans effet. Les appels à Stripe et les
   * emails partent après la validation ; s'ils échouent, l'événement est
   * oublié pour que la relance de Stripe les refasse (clés d'idempotence).
   */
  async handleStripeEvent(event: StripeEvent): Promise<void> {
    const object = event.object;
    const objectId = text(object['id']);
    const followUp = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.stripeEvent.createMany({
        data: {
          id: event.id,
          type: event.type,
          objectId,
          stripeCreatedAt:
            event.created === null ? null : new Date(event.created * 1000),
          receivedAt: this.clock.now(),
        },
        skipDuplicates: true,
      });
      if (count === 0 || !objectId) {
        return null;
      }
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          // « unpaid » : paiement différé (SEPA), son issue arrive plus tard.
          return object['payment_status'] === 'paid'
            ? this.settlePayment(tx, {
                id: objectId,
                paymentIntent: text(object['payment_intent']),
                amountTotal: object['amount_total'],
                currency: object['currency'],
                livemode: object['livemode'],
                registrationId: text(
                  (object['metadata'] as Record<string, unknown> | undefined)?.[
                    'registration'
                  ],
                ),
              })
            : null;
        case 'checkout.session.expired':
        case 'checkout.session.async_payment_failed':
          await this.releaseHold(tx, objectId);
          return null;
        case 'account.updated':
          await this.accountEvent(tx, event, objectId);
          return null;
        default:
          return null;
      }
    });
    if (!followUp) {
      return;
    }
    try {
      await followUp();
    } catch (error) {
      await this.prisma.stripeEvent.deleteMany({ where: { id: event.id } });
      throw error;
    }
  }

  /**
   * Paiement reçu : sous le verrou du tournoi, la place est confirmée s'il en
   * reste une ; sinon (place reprise après expiration, inscription déjà
   * payée, liste d'attente) le paiement est remboursé. Rend la suite à lancer
   * après la validation.
   */
  private async settlePayment(
    tx: Tx,
    session: PaidSession,
  ): Promise<(() => Promise<void>) | null> {
    const found =
      (await tx.registration.findUnique({
        where: { checkoutSessionId: session.id },
      })) ??
      // Session remplacée par une reprise du paiement : l'inscription reste dans les métadonnées.
      (session.registrationId
        ? await tx.registration.findUnique({
            where: { id: session.registrationId },
          })
        : null);
    if (!found) {
      this.logger.error(
        `Alerte paiement : session ${session.id} payée sans inscription connue.`,
      );
      return null;
    }
    if (
      session.amountTotal !== found.totalCents ||
      session.currency !== CURRENCY ||
      session.livemode !== this.stripe.livemode
    ) {
      this.logger.error(
        `Alerte paiement : session ${session.id} (inscription ${found.id}) non confirmée, ` +
          `reçu ${String(session.amountTotal)} ${String(session.currency)} livemode=${String(session.livemode)}, ` +
          `attendu ${found.totalCents} ${CURRENCY} livemode=${this.stripe.livemode}.`,
      );
      return null;
    }
    await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${found.tournamentId} FOR UPDATE`;
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: found.tournamentId },
    });
    const registration = await tx.registration.findUniqueOrThrow({
      where: { id: found.id },
    });
    const now = this.clock.now();
    const samePayment =
      session.paymentIntent !== null &&
      registration.paymentIntentId === session.paymentIntent;
    if (registration.status === 'CONFIRMED' && samePayment) {
      return null;
    }
    if (registration.status === 'CANCELLED' && samePayment) {
      // Remboursement interrompu : la relance le refait (même clé d'idempotence).
      return () => this.refund(registration, session, 'full');
    }
    if (
      registration.status !== 'PENDING_PAYMENT' &&
      registration.status !== 'EXPIRED'
    ) {
      this.logger.warn(
        `Paiement ${session.id} reçu pour l'inscription ${registration.id} (${registration.status}) : remboursé.`,
      );
      // Déjà payée par une autre session : doublon ; liste d'attente ou annulée : pas de place.
      return () =>
        this.refund(
          registration,
          session,
          registration.status === 'CONFIRMED' ? 'duplicate' : 'full',
        );
    }
    const taken = await this.occupied(
      tx,
      tournament.id,
      tournament.teamCount,
      now,
      registration.id,
    );
    if (taken >= tournament.maxTeams) {
      const cancelled = await tx.registration.update({
        where: { id: registration.id },
        data: {
          status: 'CANCELLED',
          paidAt: now,
          paymentIntentId: session.paymentIntent,
          expiresAt: null,
          checkoutUrl: null,
        },
      });
      this.logger.warn(
        `Tournoi ${tournament.slug} complet à la réception du paiement ${session.id} : inscription ${registration.id} remboursée.`,
      );
      return () => this.refund(cancelled, session, 'full');
    }
    const confirmed = await tx.registration.update({
      where: { id: registration.id },
      data: {
        status: 'CONFIRMED',
        paidAt: now,
        paymentIntentId: session.paymentIntent,
        expiresAt: null,
        checkoutUrl: null,
      },
    });
    await this.createTeam(tx, tournament, confirmed);
    return () => this.mailConfirmation(confirmed.id);
  }

  /** Session expirée ou paiement différé refusé : la place est rendue. */
  private async releaseHold(tx: Tx, sessionId: string): Promise<void> {
    await tx.registration.updateMany({
      where: { checkoutSessionId: sessionId, status: 'PENDING_PAYMENT' },
      data: { status: 'EXPIRED', checkoutUrl: null },
    });
  }

  /** account.updated : appliqué sauf si un événement plus récent du compte l'a été. */
  private async accountEvent(
    tx: Tx,
    event: StripeEvent,
    accountId: string,
  ): Promise<void> {
    // Verrou du club : deux account.updated simultanés s'appliquent l'un après l'autre.
    await tx.$queryRaw`SELECT id FROM organization WHERE stripe_account_id = ${accountId} FOR UPDATE`;
    if (event.created !== null) {
      const newer = await tx.stripeEvent.count({
        where: {
          type: 'account.updated',
          objectId: accountId,
          id: { not: event.id },
          stripeCreatedAt: { gt: new Date(event.created * 1000) },
        },
      });
      if (newer > 0) {
        return;
      }
    }
    await tx.organization.updateMany({
      where: { stripeAccountId: accountId },
      data: { stripeChargesEnabled: event.object['charges_enabled'] === true },
    });
  }

  /** Remboursement intégral (Stripe d'abord, email ensuite). */
  private async refund(
    registration: Registration,
    session: PaidSession,
    reason: 'full' | 'duplicate',
  ): Promise<void> {
    if (!session.paymentIntent) {
      this.logger.error(
        `Alerte paiement : session ${session.id} sans paiement, remboursement manuel de l'inscription ${registration.id}.`,
      );
      return;
    }
    try {
      await this.stripe.createRefund({
        paymentIntent: session.paymentIntent,
        metadata: { registration: registration.id, session: session.id },
        idempotencyKey: `refund-${session.paymentIntent}`,
      });
    } catch (error) {
      if (!(
        error instanceof StripeError && error.code === 'charge_already_refunded'
      )) {
        this.logger.error(
          `Remboursement de ${session.paymentIntent} (inscription ${registration.id}) impossible : ${(error as Error).message}`,
        );
        throw error;
      }
    }
    await this.mailRefund(registration.id, reason);
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

  /** Places prises : équipes inscrites et paiements en cours non expirés (sauf `excludeId`). */
  private async occupied(
    db: Tx | PrismaService,
    tournamentId: string,
    teamCount: number,
    now: Date,
    excludeId?: string,
  ): Promise<number> {
    const holding = await db.registration.count({
      where: {
        tournamentId,
        status: 'PENDING_PAYMENT',
        expiresAt: { gt: now },
        ...(excludeId ? { id: { not: excludeId } } : {}),
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

  private async mailRefund(
    registrationId: string,
    reason: 'full' | 'duplicate',
  ): Promise<void> {
    const registration = await this.prisma.registration.findUniqueOrThrow({
      where: { id: registrationId },
      include: { tournament: true, manager: true },
    });
    if (!registration.manager) {
      return;
    }
    await this.mailer.send(
      registrationRefundedMail(registration.manager.email, {
        team: registration.teamName,
        tournament: registration.tournament.name,
        amount: EURO_FORMAT.format(registration.totalCents / 100),
        reason,
      }),
    );
  }

  /** Le détail de Stripe reste dans le journal ; le client lit un message générique. */
  private stripeFailure(error: unknown): HttpException {
    const detail =
      error instanceof StripeError
        ? `${error.status} ${error.code ?? ''} ${error.message}`
        : String(error);
    this.logger.error(`Appel Stripe en échec : ${detail}`);
    const message =
      'Le paiement en ligne est momentanément indisponible. Réessayez dans quelques minutes.';
    return error instanceof StripeError && error.status === 503
      ? new ServiceUnavailableException(message)
      : new BadGatewayException(message);
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
