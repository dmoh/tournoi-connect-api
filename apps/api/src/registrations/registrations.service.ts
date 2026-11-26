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
import {
  keyset,
  takePage,
  type Page,
  type PageQuery,
} from '../common/pagination.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Registration, Tournament } from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import {
  SponsorInvites,
  type SponsorBilling,
} from '../sponsorships/sponsor-invites.service.js';
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
import { HOLD_MINUTES, registrationQuote } from './pricing.js';
import {
  cancellationView,
  DAY_FORMAT,
  EURO_FORMAT,
  createTeam,
  displayedStatus,
  holdingWhere,
  holdsPlace,
  lapsedWhere,
  occupiedPlaces,
  registrationOpen,
} from './registration-state.js';
import { WaitlistService } from './waitlist.service.js';
import type {
  OrganizerRegistration,
  OrganizerRegistrationsQuery,
  PaymentsStatus,
  Register,
  RegistrationInvite,
  RegistrationView,
} from './registrations.schemas.js';
import { STRIPE } from './registrations.tokens.js';

type Tx = Prisma.TransactionClient;

/** Événement du webhook Stripe, signature vérifiée. */
export interface StripeEvent {
  id: string;
  type: string;
  /** Création chez Stripe (secondes Unix), si fournie. */
  created: number | null;
  object: Record<string, unknown>;
}

/** Session Checkout payée, telle que Stripe la décrit. */
/** Pack sponsor d'une session Checkout (métadonnée « sponsorship »), sinon null. */
function sponsorshipOf(object: Record<string, unknown>): string | null {
  const value = (object['metadata'] as Record<string, unknown> | undefined)?.[
    'sponsorship'
  ];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Adresse de facturation saisie sur la page Stripe (customer_details), pour
 * la facture du club ; null si Stripe n'en rend pas de complète.
 */
function billingOf(object: Record<string, unknown>): SponsorBilling | null {
  const details = object['customer_details'] as
    Record<string, unknown> | undefined;
  const address = details?.['address'] as Record<string, unknown> | undefined;
  const line1 = text(address?.['line1']);
  const postalCode = text(address?.['postal_code']);
  const city = text(address?.['city']);
  if (!line1 || !postalCode || !city) {
    return null;
  }
  const line2 = text(address?.['line2']);
  return {
    name: text(details?.['name']),
    street: line2 ? `${line1}\n${line2}` : line1,
    postalCode,
    city,
    country: text(address?.['country']) ?? 'FR',
  };
}

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

/**
 * Inscriptions d'équipe par leur responsable : place tenue 31 minutes pendant
 * le paiement Stripe Checkout (argent versé au compte Connect du club, frais
 * de service à la plateforme), liste d'attente quand le tournoi est complet
 * (promue par WaitlistService quand une place se libère), équipe créée à la
 * confirmation.
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
    private readonly sponsorInvites: SponsorInvites,
    private readonly waitlist: WaitlistService,
  ) {}

  async invite(code: string): Promise<RegistrationInvite> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { slug: code },
      include: { venue: true, organization: true },
    });
    if (
      !tournament ||
      tournament.status === 'DRAFT' ||
      tournament.status === 'ARCHIVED' ||
      tournament.hiddenAt !== null
    ) {
      throw new NotFoundException('Lien d’inscription inconnu.');
    }
    const now = this.clock.now();
    return {
      code,
      tournament: toSummary(tournament),
      quote: registrationQuote(tournament.feeCents),
      open: registrationOpen(tournament, now),
      full:
        (await occupiedPlaces(this.prisma, tournament, now)) >=
        tournament.maxTeams,
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
      tournament.status === 'ARCHIVED' ||
      tournament.hiddenAt !== null
    ) {
      throw new NotFoundException('Lien d’inscription inconnu.');
    }
    if (!registrationOpen(tournament, now)) {
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
      const full = (await occupiedPlaces(tx, fresh, now)) >= fresh.maxTeams;
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
        await createTeam(tx, fresh, created);
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

  /** Mes équipes, plus récentes en tête, paginées sur (createdAt, id). */
  async mine(
    userId: string,
    query: PageQuery,
  ): Promise<Page<RegistrationView>> {
    const page = keyset(
      {
        scope: 'registrations:mine',
        key: 'createdAt',
        kind: 'date',
        direction: 'desc',
      },
      query,
    );
    const rows = await this.prisma.registration.findMany({
      where: { managerId: userId, ...page.where },
      orderBy: page.orderBy,
      take: page.take,
      include: {
        tournament: true,
        team: { select: { code: true, arrivedAt: true } },
      },
    });
    const result = page.finish(rows, (row) => row);
    return {
      items: await Promise.all(result.items.map((r) => this.toView(r))),
      nextCursor: result.nextCursor,
    };
  }

  async view(id: string, userId: string): Promise<RegistrationView> {
    const registration = await this.prisma.registration.findFirst({
      where: { id, managerId: userId },
      include: {
        tournament: true,
        team: { select: { code: true, arrivedAt: true } },
      },
    });
    if (!registration) {
      throw new NotFoundException('Inscription introuvable.');
    }
    return this.toView(registration);
  }

  private async toView(
    registration: Registration & {
      tournament: Tournament;
      team?: { code: string; arrivedAt: Date | null } | null;
    },
  ): Promise<RegistrationView> {
    const now = this.clock.now();
    const status = displayedStatus(registration, now);
    // Page de paiement encore ouverte (une place proposée peut n'en avoir aucune).
    const liveCheckout =
      status === 'PENDING_PAYMENT' &&
      registration.checkoutUrl !== null &&
      registration.expiresAt !== null &&
      registration.expiresAt > now;
    // Rang dans la file (createdAt, id) : le même ordre que la promotion.
    const waitlistPosition =
      status === 'WAITLISTED'
        ? (await this.prisma.registration.count({
            where: {
              tournamentId: registration.tournamentId,
              status: 'WAITLISTED',
              OR: [
                { createdAt: { lt: registration.createdAt } },
                {
                  createdAt: registration.createdAt,
                  id: { lt: registration.id },
                },
              ],
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
      ...(liveCheckout
        ? {
            checkoutUrl: registration.checkoutUrl!,
            expiresAt: registration.expiresAt!.toISOString(),
          }
        : {}),
      ...(status === 'PENDING_PAYMENT' && registration.paymentDueAt
        ? { paymentDueAt: registration.paymentDueAt.toISOString() }
        : {}),
      ...cancellationView(registration),
      // Équipe inscrite à un tournoi à venir : son agenda en un appui.
      ...(status === 'CONFIRMED' &&
      registration.team &&
      registration.tournament.endsAt > now
        ? {
            teamCode: registration.team.code,
            // Jour J (4 h avant le début → fin) : « Nous sommes arrivés » en un appui.
            arrival: {
              token: registration.arrivalToken,
              open:
                now.getTime() >=
                  registration.tournament.startsAt.getTime() - 4 * 3_600_000 &&
                now <= registration.tournament.endsAt,
              arrivedAt: registration.team.arrivedAt?.toISOString() ?? null,
            },
          }
        : {}),
      createdAt: registration.createdAt.toISOString(),
    };
  }

  /**
   * Ouvre le paiement d'une place proposée depuis la liste d'attente (tenue
   * jusqu'à `paymentDueAt`, page Stripe de 31 minutes), ou reprend un
   * paiement dont la place a expiré s'il en reste une.
   */
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
    const { tournament } = registration;
    const offered =
      registration.status === 'PENDING_PAYMENT' &&
      registration.paymentDueAt !== null &&
      registration.paymentDueAt > now;
    const liveCheckout =
      registration.expiresAt !== null && registration.expiresAt > now;
    if (offered && !liveCheckout) {
      const held = await this.prisma.registration.update({
        where: { id },
        data: {
          expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
          checkoutSessionId: null,
          checkoutUrl: null,
        },
      });
      await this.openCheckout(held, tournament, registration.manager!.email, {
        keepOffer: true,
      });
      return this.view(id, userId);
    }
    if (displayedStatus(registration, now) !== 'EXPIRED') {
      return this.view(id, userId);
    }
    if (!registrationOpen(tournament, now)) {
      throw new ConflictException(
        'Les inscriptions de ce tournoi sont fermées.',
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${tournament.id} FOR UPDATE`;
      const fresh = await tx.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
      });
      const full = (await occupiedPlaces(tx, fresh, now)) >= fresh.maxTeams;
      return tx.registration.update({
        where: { id },
        data: full
          ? {
              status: 'WAITLISTED',
              expiresAt: null,
              paymentDueAt: null,
              checkoutSessionId: null,
              checkoutUrl: null,
            }
          : {
              status: 'PENDING_PAYMENT',
              expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
              paymentDueAt: null,
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
          if (sponsorshipOf(object)) {
            // Pack sponsor payé en ligne (lot 13) : pas une inscription.
            return object['payment_status'] === 'paid'
              ? this.sponsorInvites.settle(tx, {
                  id: objectId,
                  paymentIntent: text(object['payment_intent']),
                  amountTotal: object['amount_total'],
                  currency: object['currency'],
                  livemode: object['livemode'],
                  sponsorshipId: sponsorshipOf(object)!,
                  email:
                    text(
                      (
                        object['customer_details'] as
                          Record<string, unknown> | undefined
                      )?.['email'],
                    ) ?? text(object['customer_email']),
                  billing: billingOf(object),
                })
              : null;
          }
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
          return this.releaseHold(tx, objectId);
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
      // Annulée par le club : son remboursement (ou son absence) est décidé là.
      if (registration.cancellation) {
        return null;
      }
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
    const taken = await occupiedPlaces(tx, tournament, now, registration.id);
    if (taken >= tournament.maxTeams) {
      const cancelled = await tx.registration.update({
        where: { id: registration.id },
        data: {
          status: 'CANCELLED',
          paidAt: now,
          paymentIntentId: session.paymentIntent,
          expiresAt: null,
          paymentDueAt: null,
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
        paymentDueAt: null,
        checkoutUrl: null,
      },
    });
    await createTeam(tx, tournament, confirmed);
    return () => this.mailConfirmation(confirmed.id);
  }

  /**
   * Session expirée ou paiement différé refusé : la place est rendue et la
   * liste d'attente promue (après validation). Une place proposée depuis la
   * liste d'attente reste tenue jusqu'à son échéance : seule la page de
   * paiement se ferme.
   */
  private async releaseHold(
    tx: Tx,
    sessionId: string,
  ): Promise<(() => Promise<void>) | null> {
    const held = await tx.registration.findUnique({
      where: { checkoutSessionId: sessionId },
    });
    if (!held || held.status !== 'PENDING_PAYMENT') {
      return null;
    }
    const now = this.clock.now();
    if (held.paymentDueAt !== null && held.paymentDueAt > now) {
      await tx.registration.update({
        where: { id: held.id },
        data: { checkoutUrl: null, expiresAt: null },
      });
      return null;
    }
    const wasHolding = holdsPlace(held, now);
    await tx.registration.update({
      where: { id: held.id },
      data: { status: 'EXPIRED', checkoutUrl: null },
    });
    return wasHolding
      ? () => this.waitlist.placeFreed(held.tournamentId, `${held.id}-expired`)
      : null;
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

  /**
   * Tableau des inscriptions d'un tournoi du club : tri (date d'inscription
   * ou nom d'équipe, dans les deux sens, départagé par id) et filtre de
   * statut côté serveur, paginé par curseur.
   */
  async organizerRegistrations(
    organizationSlug: string,
    slug: string,
    query: OrganizerRegistrationsQuery,
  ): Promise<Page<OrganizerRegistration>> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const now = this.clock.now();
    const direction = query.sort.startsWith('-') ? 'desc' : 'asc';
    const key = query.sort.replace('-', '') as 'createdAt' | 'teamName';
    const scope = `registrations:organizer:${query.sort}`;
    const page =
      key === 'createdAt'
        ? keyset({ scope, key: 'createdAt', kind: 'date', direction }, query)
        : keyset({ scope, key: 'teamName', kind: 'text', direction }, query);
    const rows = await this.prisma.registration.findMany({
      where: {
        tournamentId: tournament.id,
        AND: [page.where, this.displayedStatus(query.status, now)],
      },
      include: { manager: { select: { email: true } } },
      orderBy: page.orderBy,
      take: page.take,
    });
    const { rows: kept, nextCursor } = takePage(
      rows,
      query.limit,
      page.cursorOf,
    );
    const positions = await this.waitlistPositions(
      tournament.id,
      kept.filter((r) => r.status === 'WAITLISTED').map((r) => r.id),
    );
    const items = kept.map((r) =>
      this.toOrganizerRow(r, now, positions.get(r.id)),
    );
    return { items, nextCursor };
  }

  /** Une inscription d'un tournoi du club (après une promotion à la main) ; 404 hors du club. */
  async organizerRegistration(
    organizationSlug: string,
    slug: string,
    id: string,
  ): Promise<OrganizerRegistration> {
    const registration = await this.prisma.registration.findFirst({
      where: {
        id,
        tournament: { slug, organization: { slug: organizationSlug } },
      },
      include: { manager: { select: { email: true } } },
    });
    if (!registration) {
      throw new NotFoundException('Inscription introuvable.');
    }
    const positions = await this.waitlistPositions(
      registration.tournamentId,
      registration.status === 'WAITLISTED' ? [id] : [],
    );
    return this.toOrganizerRow(
      registration,
      this.clock.now(),
      positions.get(id),
    );
  }

  private toOrganizerRow(
    r: Registration & { manager: { email: string } | null },
    now: Date,
    waitlistPosition: number | undefined,
  ): OrganizerRegistration {
    const status = displayedStatus(r, now);
    return {
      id: r.id,
      teamName: r.teamName,
      club: r.club,
      managerName: r.managerName,
      email: r.manager?.email ?? null,
      phone: r.phone,
      players: Array.isArray(r.players) ? r.players.length : 0,
      status,
      totalCents: r.totalCents,
      paid: r.paidAt !== null && r.paymentIntentId !== null,
      ...(waitlistPosition ? { waitlistPosition } : {}),
      ...(status === 'PENDING_PAYMENT' && r.paymentDueAt
        ? { paymentDueAt: r.paymentDueAt.toISOString() }
        : {}),
      ...cancellationView(r),
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Rang dans la liste d'attente (createdAt, id) des inscriptions demandées, en une requête. */
  private async waitlistPositions(
    tournamentId: string,
    ids: string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.$queryRaw<
      { id: string; position: bigint }[]
    >`SELECT id, position FROM (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS position
        FROM registration
        WHERE tournament_id = ${tournamentId} AND status = 'WAITLISTED'
      ) ranked WHERE id IN (${Prisma.join(ids)})`;
    return new Map(rows.map((r) => [r.id, Number(r.position)]));
  }

  /**
   * Filtre du statut affiché : une place tenue dont le paiement a expiré
   * s'affiche EXPIRED avant que le worker ne l'écrive.
   */
  private displayedStatus(
    status: OrganizerRegistrationsQuery['status'],
    now: Date,
  ): Prisma.RegistrationWhereInput {
    switch (status) {
      case undefined:
        return {};
      case 'EXPIRED':
        return { OR: [{ status: 'EXPIRED' }, lapsedWhere(now)] };
      case 'PENDING_PAYMENT':
        return holdingWhere(now);
      default:
        return { status };
    }
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
    { keepOffer = false } = {},
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
      if (keepOffer) {
        // La place proposée reste tenue jusqu'à son échéance ; le responsable réessaiera.
        await this.prisma.registration.update({
          where: { id: registration.id },
          data: { expiresAt: null },
        });
      } else {
        // Sans page de paiement, la place n'est pas tenue : la liste d'attente en profite.
        await this.prisma.registration.update({
          where: { id: registration.id },
          data: { status: 'EXPIRED' },
        });
        await this.waitlist.placeFreed(
          tournament.id,
          `${registration.id}-no-checkout`,
        );
      }
      throw this.stripeFailure(error);
    }
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
