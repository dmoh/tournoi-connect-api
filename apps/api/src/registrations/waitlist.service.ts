import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  Prisma,
  Registration,
  Tournament,
} from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import {
  registrationConfirmedMail,
  waitlistOfferMail,
} from '../mail/templates.js';
import { PushService } from '../push/push.service.js';
import { WAITLIST_QUEUE } from '../queue/queue.module.js';
import {
  DAY_FORMAT,
  EURO_FORMAT,
  createTeam,
  holdsPlace,
  lapsedWhere,
  occupiedPlaces,
  registrationOpen,
} from './registration-state.js';

type Tx = Prisma.TransactionClient;

/** Place proposée depuis la liste d'attente : délai de paiement. */
export const OFFER_HOURS = 48;

/** Balayage de secours du worker (offres échues, places rendues sans webhook). */
export const WAITLIST_SWEEP_MS = 10 * 60_000;

/** Tâche de la file : promouvoir la liste d'attente d'un tournoi. */
export interface WaitlistJob {
  tournamentId: string;
}

/** Ce qu'une promotion a fait d'une inscription, à annoncer après validation. */
type Promotion =
  | { id: string; kind: 'confirmed' }
  | { id: string; kind: 'offered'; dueAt: Date };

const DUE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Promotion de la liste d'attente (t11). Quand une place se libère, la plus
 * ancienne inscription WAITLISTED du tournoi (createdAt, id) la prend :
 * confirmée aussitôt si le tournoi est gratuit, sinon tenue 48 heures
 * (`paymentDueAt`) le temps que le responsable paie depuis Mes équipes. Tout
 * se fait sous le verrou du tournoi, comme le webhook Stripe : deux places
 * rendues en même temps promeuvent deux équipes distinctes, jamais au-delà
 * de la capacité. La requête HTTP ne fait que déposer la tâche ; le worker
 * promeut, prévient (email, push) et fait échoir les offres.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger('Liste d’attente');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly push: PushService,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @InjectQueue(WAITLIST_QUEUE)
    private readonly queue?: Queue<WaitlistJob>,
  ) {}

  /**
   * Une place vient d'être rendue : le worker promeut la liste d'attente.
   * `trigger` (inscription et transition) rend le dépôt idempotent ; sans
   * Redis (tests, poste local), la promotion se fait tout de suite.
   */
  async placeFreed(tournamentId: string, trigger: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        'promote',
        { tournamentId },
        { jobId: `promote-${tournamentId}-${trigger}` },
      );
    } else {
      await this.promote(tournamentId);
    }
  }

  /**
   * Promeut la liste d'attente d'un tournoi jusqu'à sa capacité, après avoir
   * fait échoir les offres arrivées à leur date limite. Rend les inscriptions
   * promues ; relançable sans effet quand il n'y a rien à faire.
   */
  async promote(tournamentId: string): Promise<string[]> {
    const now = this.clock.now();
    const promotions = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${tournamentId} FOR UPDATE`;
      let tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
      });
      if (!tournament) {
        return [];
      }
      // Paiements en attente dont la place est rendue (offre échue, page de
      // paiement fermée sans webhook) : écrits EXPIRED avant de recompter.
      const lapsed = await tx.registration.updateMany({
        where: { tournamentId, ...lapsedWhere(now) },
        data: { status: 'EXPIRED', checkoutUrl: null },
      });
      if (lapsed.count > 0) {
        this.logger.log(
          `Tournoi ${tournament.slug} : ${lapsed.count} place(s) rendue(s) après échéance.`,
        );
      }
      if (!registrationOpen(tournament, now)) {
        return [];
      }
      const done: Promotion[] = [];
      for (;;) {
        const taken = await occupiedPlaces(tx, tournament, now);
        if (taken >= tournament.maxTeams) {
          break;
        }
        const next = await tx.registration.findFirst({
          where: { tournamentId, status: 'WAITLISTED' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        if (!next) {
          break;
        }
        done.push(await this.offer(tx, tournament, next, now));
        tournament = await tx.tournament.findUniqueOrThrow({
          where: { id: tournamentId },
        });
      }
      return done;
    });
    for (const promotion of promotions) {
      await this.announce(promotion);
    }
    return promotions.map((p) => p.id);
  }

  /**
   * Promotion à la main par l'organisateur (même chemin que l'automatique) :
   * l'inscription doit être en liste d'attente d'un tournoi du club, ouvert
   * et non complet. Hors du club : 404.
   */
  async promoteManually(
    organizationSlug: string,
    slug: string,
    registrationId: string,
  ): Promise<Registration> {
    const now = this.clock.now();
    const promotion = await this.prisma.$transaction(async (tx) => {
      const found = await tx.tournament.findFirst({
        where: { slug, organization: { slug: organizationSlug } },
      });
      if (!found) {
        throw new NotFoundException('Tournoi introuvable.');
      }
      await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${found.id} FOR UPDATE`;
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id: found.id },
      });
      const registration = await tx.registration.findFirst({
        where: { id: registrationId, tournamentId: tournament.id },
      });
      if (!registration) {
        throw new NotFoundException('Inscription introuvable.');
      }
      if (registration.status !== 'WAITLISTED') {
        throw new ConflictException(
          'Cette inscription n’est pas en liste d’attente.',
        );
      }
      if (!registrationOpen(tournament, now)) {
        throw new ConflictException(
          'Les inscriptions de ce tournoi sont fermées.',
        );
      }
      if ((await occupiedPlaces(tx, tournament, now)) >= tournament.maxTeams) {
        throw new ConflictException(
          'Le tournoi est complet : aucune place à proposer.',
        );
      }
      return this.offer(tx, tournament, registration, now);
    });
    await this.announce(promotion);
    return this.prisma.registration.findUniqueOrThrow({
      where: { id: promotion.id },
    });
  }

  /**
   * Le responsable renonce : liste d'attente, place proposée ou paiement en
   * cours passent CANCELLED ; une place tenue est rendue et la suivante
   * promue. Une équipe inscrite se désiste auprès de l'organisateur (409).
   */
  async decline(registrationId: string, userId: string): Promise<void> {
    const found = await this.prisma.registration.findFirst({
      where: { id: registrationId, managerId: userId },
    });
    if (!found) {
      throw new NotFoundException('Inscription introuvable.');
    }
    if (found.status === 'CANCELLED') {
      return;
    }
    const now = this.clock.now();
    const freed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tournament WHERE id = ${found.tournamentId} FOR UPDATE`;
      const fresh = await tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      if (fresh.status === 'CONFIRMED') {
        throw new ConflictException(
          'Votre équipe est inscrite : contactez l’organisateur pour vous désister.',
        );
      }
      if (fresh.status === 'CANCELLED') {
        return false;
      }
      // Une place n'est rendue que si l'inscription en tenait une.
      const held = holdsPlace(fresh, now);
      await tx.registration.update({
        where: { id: registrationId },
        data: {
          status: 'CANCELLED',
          expiresAt: null,
          paymentDueAt: null,
          checkoutUrl: null,
        },
      });
      return held;
    });
    if (freed) {
      await this.placeFreed(found.tournamentId, `${registrationId}-declined`);
    }
  }

  /**
   * Balayage périodique du worker : tournois ouverts avec une liste d'attente
   * ou une offre échue. Rattrape les places rendues sans webhook et les
   * tâches différées perdues.
   */
  async sweep(): Promise<number> {
    const now = this.clock.now();
    const groups = await this.prisma.registration.groupBy({
      by: ['tournamentId'],
      where: {
        OR: [
          { status: 'WAITLISTED' },
          { status: 'PENDING_PAYMENT', paymentDueAt: { lte: now } },
        ],
        tournament: { status: 'REGISTRATION_OPEN' },
      },
      orderBy: { tournamentId: 'asc' },
      take: 500,
    });
    let promoted = 0;
    for (const { tournamentId } of groups) {
      promoted += (await this.promote(tournamentId)).length;
    }
    return promoted;
  }

  /** Sous le verrou : confirme (gratuit) ou propose la place 48 heures (payant). */
  private async offer(
    tx: Tx,
    tournament: Tournament,
    registration: Registration,
    now: Date,
  ): Promise<Promotion> {
    if (registration.totalCents === 0) {
      const confirmed = await tx.registration.update({
        where: { id: registration.id },
        data: {
          status: 'CONFIRMED',
          expiresAt: null,
          paymentDueAt: null,
          checkoutUrl: null,
        },
      });
      await createTeam(tx, tournament, confirmed);
      this.logger.log(
        `Tournoi ${tournament.slug} : ${registration.teamName} promue et inscrite.`,
      );
      return { id: registration.id, kind: 'confirmed' };
    }
    const dueAt = new Date(now.getTime() + OFFER_HOURS * 60 * 60_000);
    await tx.registration.update({
      where: { id: registration.id },
      data: {
        status: 'PENDING_PAYMENT',
        paymentDueAt: dueAt,
        expiresAt: null,
        checkoutSessionId: null,
        checkoutUrl: null,
      },
    });
    this.logger.log(
      `Tournoi ${tournament.slug} : place proposée à ${registration.teamName} jusqu'au ${dueAt.toISOString()}.`,
    );
    return { id: registration.id, kind: 'offered', dueAt };
  }

  /** Après validation : échéance de l'offre, email et push au responsable. */
  private async announce(promotion: Promotion): Promise<void> {
    const registration = await this.prisma.registration.findUniqueOrThrow({
      where: { id: promotion.id },
      include: { tournament: true, manager: true },
    });
    const { tournament, manager } = registration;
    if (promotion.kind === 'offered' && this.queue) {
      // À l'échéance, l'offre expire et la suivante est promue (promote).
      await this.queue.add(
        'promote',
        { tournamentId: tournament.id },
        {
          delay: Math.max(
            0,
            promotion.dueAt.getTime() - this.clock.now().getTime(),
          ),
          jobId: `offer-${registration.id}-${promotion.dueAt.getTime()}`,
        },
      );
    }
    // Compte supprimé entre-temps : personne à prévenir.
    if (!manager) {
      return;
    }
    const url = this.appUrl('/my-teams');
    if (promotion.kind === 'confirmed') {
      await this.mailer.send(
        registrationConfirmedMail(manager.email, {
          team: registration.teamName,
          tournament: tournament.name,
          date: DAY_FORMAT.format(tournament.startsAt),
          url: this.appUrl(`/t/${tournament.slug}`),
        }),
      );
      await this.push.notifyUser({
        kind: 'user',
        userId: manager.id,
        title: `${registration.teamName} est inscrite`,
        body: `Une place s’est libérée au ${tournament.name} : votre équipe est inscrite.`,
        url: '/my-teams',
        tag: `registration-${registration.id}`,
        eventId: `${registration.id}-confirmed`,
      });
      return;
    }
    const dueDate = DUE_FORMAT.format(promotion.dueAt);
    await this.mailer.send(
      waitlistOfferMail(manager.email, {
        team: registration.teamName,
        tournament: tournament.name,
        date: DAY_FORMAT.format(tournament.startsAt),
        amount: EURO_FORMAT.format(registration.totalCents / 100),
        dueDate,
        url,
      }),
    );
    await this.push.notifyUser({
      kind: 'user',
      userId: manager.id,
      title: `Une place s’est libérée pour ${registration.teamName}`,
      body: `${tournament.name} : payez votre place avant le ${dueDate}.`,
      url: '/my-teams',
      tag: `registration-${registration.id}`,
      eventId: `${registration.id}-offered-${promotion.dueAt.getTime()}`,
    });
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
