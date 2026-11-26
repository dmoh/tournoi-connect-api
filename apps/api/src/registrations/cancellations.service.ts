import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, Tournament } from '../generated/prisma/client.js';
import type { TournamentStatus } from '../generated/prisma/enums.js';
import { Mailer } from '../mail/mailer.js';
import {
  registrationWithdrawnMail,
  tournamentCancelledMail,
} from '../mail/templates.js';
import { StripeClient, StripeError } from '../payments/stripe-client.js';
import { PushService } from '../push/push.service.js';
import { REFUND_QUEUE } from '../queue/queue.module.js';
import type {
  CancellationPreview,
  CancellationResult,
} from './cancellations.schemas.js';
import {
  DAY_FORMAT,
  EURO_FORMAT,
  displayedStatus,
  holdsPlace,
} from './registration-state.js';
import { STRIPE } from './registrations.tokens.js';
import { WaitlistService } from './waitlist.service.js';

type Tx = Prisma.TransactionClient;

/** Tâche de la file : rembourser une inscription annulée par le club. */
export interface RefundJob {
  registrationId: string;
}

/** Rattrapage du worker : remboursements restés en attente. */
export const REFUND_SWEEP_MS = 10 * 60_000;
/** Un remboursement n'est rattrapé qu'après ce délai (la file l'a déjà tenté). */
const SWEEP_GRACE_MS = 15 * 60_000;
const SWEEP_BATCH = 100;

/** Inscriptions encore actives : elles sont annulées avec le tournoi. */
const ACTIVE = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'] as const;
/** Un tournoi terminé, archivé ou déjà annulé ne s'annule plus. */
const CLOSED: readonly TournamentStatus[] = [
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
];

const paid = (r: { paidAt: Date | null; paymentIntentId: string | null }) =>
  r.paidAt !== null && r.paymentIntentId !== null;

/**
 * Annulations par le club : désistement d'une équipe (remboursée ou non) et
 * annulation d'un tournoi (toutes les équipes remboursées, suiveurs
 * prévenus). Tout s'écrit sous le verrou du tournoi, comme le webhook Stripe :
 * un paiement qui arrive après l'annulation est remboursé par le webhook. Les
 * remboursements partent au worker (file `refund`, clé d'idempotence par
 * inscription) ; un balayage rattrape ceux qui n'ont pas abouti.
 */
@Injectable()
export class CancellationsService {
  private readonly logger = new Logger('Annulations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly push: PushService,
    private readonly waitlist: WaitlistService,
    @Inject(STRIPE) private readonly stripe: StripeClient,
    @Optional()
    @InjectQueue(REFUND_QUEUE)
    private readonly queue?: Queue<RefundJob>,
  ) {}

  /**
   * Désiste une équipe inscrite, en liste d'attente ou en cours de paiement.
   * Une équipe déjà tirée au sort défait le tirage (à refaire) tant qu'aucun
   * match n'a commencé ; ensuite : 409. La place rendue est proposée à la
   * liste d'attente.
   */
  async withdraw(
    organizationSlug: string,
    slug: string,
    registrationId: string,
    refund: boolean,
  ): Promise<{ drawReset: boolean }> {
    const now = this.clock.now();
    const done = await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockOwn(tx, organizationSlug, slug);
      if (CLOSED.includes(tournament.status)) {
        throw new ConflictException(
          'Ce tournoi est terminé ou annulé : ses inscriptions ne changent plus.',
        );
      }
      const registration = await tx.registration.findFirst({
        where: { id: registrationId, tournamentId: tournament.id },
      });
      if (!registration) {
        throw new NotFoundException('Inscription introuvable.');
      }
      const status = displayedStatus(registration, now);
      if (!(ACTIVE as readonly string[]).includes(status)) {
        throw new ConflictException('Cette inscription est déjà close.');
      }
      let drawReset = false;
      if (registration.teamId) {
        drawReset = await this.removeTeam(tx, tournament, registration.teamId);
      }
      const freed =
        registration.status === 'CONFIRMED' || holdsPlace(registration, now);
      const refundCents =
        refund && paid(registration) ? registration.totalCents : 0;
      await tx.registration.update({
        where: { id: registration.id },
        data: {
          status: 'CANCELLED',
          cancellation: 'WITHDRAWN',
          cancelledAt: now,
          refundCents,
          expiresAt: null,
          paymentDueAt: null,
          checkoutUrl: null,
        },
      });
      return { freed, refundCents, drawReset, tournament };
    });
    if (done.refundCents > 0) {
      await this.enqueueRefund(registrationId);
    }
    await this.mailWithdrawn(registrationId);
    if (done.freed) {
      await this.waitlist.placeFreed(
        done.tournament.id,
        `${registrationId}-withdrawn`,
      );
    }
    this.logger.log(
      `Équipe ${registrationId} désistée du tournoi ${slug} (remboursement ${done.refundCents} c).`,
    );
    return { drawReset: done.drawReset };
  }

  /** Ce que l'annulation du tournoi ferait : équipes, remboursements, sponsors payés. */
  async preview(
    organizationSlug: string,
    slug: string,
  ): Promise<CancellationPreview> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const now = this.clock.now();
    const [registrations, sponsorsPaid] = await Promise.all([
      this.prisma.registration.findMany({
        where: { tournamentId: tournament.id, status: { in: [...ACTIVE] } },
      }),
      this.prisma.tournamentSponsor.count({
        where: { tournamentId: tournament.id, status: 'PAID' },
      }),
    ]);
    const active = registrations.filter((r) =>
      (ACTIVE as readonly string[]).includes(displayedStatus(r, now)),
    );
    const refunds = active.filter(paid);
    return {
      name: tournament.name,
      startsAt: tournament.startsAt.toISOString(),
      cancellable: !CLOSED.includes(tournament.status),
      status: tournament.status,
      registrations: active.length,
      refunds: {
        count: refunds.length,
        totalCents: refunds.reduce((sum, r) => sum + r.totalCents, 0),
      },
      sponsorsPaid,
    };
  }

  /**
   * Annule le tournoi (propriétaire du club) : statut CANCELLED avec le
   * motif, toutes les inscriptions actives annulées et celles payées
   * remboursées en entier ; responsables prévenus par email, suiveurs par
   * notification. Les packs sponsors restent à régler avec les sponsors.
   */
  async cancelTournament(
    organizationSlug: string,
    slug: string,
    reason: string,
  ): Promise<CancellationResult> {
    const now = this.clock.now();
    const done = await this.prisma.$transaction(async (tx) => {
      const tournament = await this.lockOwn(tx, organizationSlug, slug);
      if (CLOSED.includes(tournament.status)) {
        throw new ConflictException(
          tournament.status === 'CANCELLED'
            ? 'Ce tournoi est déjà annulé.'
            : 'Un tournoi terminé ne s’annule plus.',
        );
      }
      const registrations = await tx.registration.findMany({
        where: { tournamentId: tournament.id, status: { in: [...ACTIVE] } },
      });
      const cancelled: { id: string; refundCents: number }[] = [];
      for (const r of registrations) {
        const refundCents = paid(r) ? r.totalCents : 0;
        await tx.registration.update({
          where: { id: r.id },
          data: {
            status: 'CANCELLED',
            cancellation: 'TOURNAMENT_CANCELLED',
            cancelledAt: now,
            refundCents,
            expiresAt: null,
            paymentDueAt: null,
            checkoutUrl: null,
          },
        });
        cancelled.push({ id: r.id, refundCents });
      }
      const updated = await tx.tournament.update({
        where: { id: tournament.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancellationReason: reason,
        },
      });
      return { tournament: updated, cancelled };
    });
    for (const r of done.cancelled) {
      if (r.refundCents > 0) {
        await this.enqueueRefund(r.id);
      }
    }
    await this.mailCancelled(done.tournament, done.cancelled);
    await this.push
      .notify({
        kind: 'result',
        tournamentSlug: slug,
        matchCode: 'annulation',
        homeTeam: null,
        awayTeam: null,
        title: `${done.tournament.name} est annulé`,
        body: reason,
        url: `/t/${slug}`,
        tag: `annulation-${slug}`,
        eventId: `annulation-${slug}`,
      })
      .catch((error: unknown) => this.logger.error(error));
    const refunds = done.cancelled.filter((r) => r.refundCents > 0);
    this.logger.log(
      `Tournoi ${slug} annulé : ${done.cancelled.length} inscriptions, ${refunds.length} remboursements.`,
    );
    return {
      slug,
      status: 'CANCELLED',
      cancelledAt: now.toISOString(),
      reason,
      registrations: done.cancelled.length,
      refunds: {
        count: refunds.length,
        totalCents: refunds.reduce((sum, r) => sum + r.refundCents, 0),
      },
    };
  }

  /** Dépose le remboursement pour le worker ; sans Redis, le fait tout de suite. */
  async enqueueRefund(registrationId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        'refund',
        { registrationId },
        { jobId: `refund-${registrationId}` },
      );
    } else {
      // Échec journalisé par refund() : le balayage réessaie.
      await this.refund(registrationId).catch(() => undefined);
    }
  }

  /**
   * Rembourse chez Stripe (charge de destination : virement au club et frais
   * de service repris) une inscription annulée par le club. Relançable : la
   * clé d'idempotence est celle de l'inscription, un paiement déjà remboursé
   * compte comme fait.
   */
  async refund(registrationId: string): Promise<'refunded' | 'skipped'> {
    const r = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });
    if (!r || !r.refundCents || r.refundedAt || !r.paymentIntentId) {
      return 'skipped';
    }
    try {
      await this.stripe.createRefund({
        paymentIntent: r.paymentIntentId,
        metadata: {
          registration: r.id,
          reason: r.cancellation ?? 'club',
        },
        idempotencyKey: `cancel-${r.id}`,
      });
    } catch (error) {
      if (!(
        error instanceof StripeError && error.code === 'charge_already_refunded'
      )) {
        this.logger.error(
          `Remboursement de l'inscription ${r.id} (${r.paymentIntentId}) impossible : ${(error as Error).message}`,
        );
        throw error;
      }
    }
    await this.prisma.registration.updateMany({
      where: { id: r.id, refundedAt: null },
      data: { refundedAt: this.clock.now() },
    });
    return 'refunded';
  }

  /** Balayage du worker : remboursements en attente depuis plus de 15 minutes. */
  async sweep(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - SWEEP_GRACE_MS);
    const pending = await this.prisma.registration.findMany({
      where: {
        refundedAt: null,
        refundCents: { gt: 0 },
        cancelledAt: { lte: before },
      },
      select: { id: true },
      orderBy: { cancelledAt: 'asc' },
      take: SWEEP_BATCH,
    });
    let refunded = 0;
    for (const { id } of pending) {
      try {
        if ((await this.refund(id)) === 'refunded') {
          refunded += 1;
        }
      } catch {
        // Journalisé par refund() ; le prochain balayage réessaie.
      }
    }
    return refunded;
  }

  /** Tournoi du club, verrouillé pour la transaction ; hors du club : 404. */
  private async lockOwn(
    tx: Tx,
    organizationSlug: string,
    slug: string,
  ): Promise<Tournament> {
    const found = await tx.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${found.id} FOR UPDATE`;
    return tx.tournament.findUniqueOrThrow({ where: { id: found.id } });
  }

  /**
   * Retire l'équipe et sa place. Si le tirage la comprend, il est défait
   * (matchs supprimés, poules vidées) tant qu'aucun match n'a commencé.
   */
  private async removeTeam(
    tx: Tx,
    tournament: Tournament,
    teamId: string,
  ): Promise<boolean> {
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) {
      return false;
    }
    const matches = await tx.match.findMany({
      where: { tournamentId: tournament.id },
      select: { status: true, homeTeamCode: true, awayTeamCode: true },
    });
    const drawn = matches.length > 0;
    if (matches.some((m) => m.status !== 'SCHEDULED')) {
      throw new ConflictException(
        'Des matchs ont commencé : le tirage ne peut plus être refait sans cette équipe.',
      );
    }
    if (drawn) {
      await tx.match.deleteMany({ where: { tournamentId: tournament.id } });
      await tx.team.updateMany({
        where: { tournamentId: tournament.id },
        data: { group: null, byeRounds: [] },
      });
    }
    await tx.team.delete({ where: { id: team.id } });
    await tx.tournament.update({
      where: { id: tournament.id },
      data: {
        teamCount: { decrement: 1 },
        ...(drawn ? { drawSeed: null, swissRounds: null } : {}),
      },
    });
    return drawn;
  }

  private async mailWithdrawn(registrationId: string): Promise<void> {
    const r = await this.prisma.registration.findUniqueOrThrow({
      where: { id: registrationId },
      include: { tournament: true, manager: true },
    });
    if (!r.manager) {
      return;
    }
    await this.mailer.send(
      registrationWithdrawnMail(r.manager.email, {
        team: r.teamName,
        tournament: r.tournament.name,
        refund: r.refundCents ? EURO_FORMAT.format(r.refundCents / 100) : null,
      }),
    );
  }

  private async mailCancelled(
    tournament: Tournament,
    cancelled: readonly { id: string; refundCents: number }[],
  ): Promise<void> {
    const rows = await this.prisma.registration.findMany({
      where: { id: { in: cancelled.map((c) => c.id) } },
      include: { manager: true },
    });
    for (const r of rows) {
      if (!r.manager) {
        continue;
      }
      await this.mailer.send(
        tournamentCancelledMail(r.manager.email, {
          team: r.teamName,
          tournament: tournament.name,
          date: DAY_FORMAT.format(tournament.startsAt),
          reason: tournament.cancellationReason ?? '',
          refund: r.refundCents
            ? EURO_FORMAT.format(r.refundCents / 100)
            : null,
        }),
      );
    }
  }
}
