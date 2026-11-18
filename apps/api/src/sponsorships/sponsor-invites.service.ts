import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import {
  sponsorInvitationMail,
  sponsorPaidClubMail,
  sponsorReceiptMail,
} from '../mail/templates.js';
import { registrationQuote } from '../registrations/pricing.js';
import type { InviteLink } from './sponsorships.schemas.js';

type Tx = Prisma.TransactionClient;

/** Empreinte du lien : seule elle est gardée en base. */
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

/** Session Stripe payée d'un pack sponsor (webhook). */
export interface SponsorPaidSession {
  id: string;
  paymentIntent: string | null;
  amountTotal: unknown;
  currency: unknown;
  livemode: unknown;
  sponsorshipId: string;
  /** Adresse saisie sur la page de paiement, pour le reçu. */
  email: string | null;
}

/**
 * Lien de paiement d'un sponsor et règlement du pack : le lien personnel
 * (aléatoire, seule son empreinte est gardée) ouvre la page de paiement ; le
 * webhook Stripe marque le pack payé, envoie le reçu au sponsor et prévient
 * le club. Sans dépendance à Stripe : le webhook des inscriptions l'appelle.
 */
@Injectable()
export class SponsorInvites {
  private readonly logger = new Logger(SponsorInvites.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Nouveau lien (l'ancien ne marche plus), envoyé au sponsor s'il a une adresse. */
  async issue(
    sponsorshipId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<InviteLink> {
    const row = await db.tournamentSponsor.findUnique({
      where: { id: sponsorshipId },
      include: {
        sponsor: true,
        tournament: { include: { organization: true, packages: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Sponsor introuvable.');
    }
    const token = randomBytes(24).toString('base64url');
    await db.tournamentSponsor.update({
      where: { id: row.id },
      data: { inviteTokenHash: hashToken(token) },
    });
    const url = this.appUrl(`/sponsor/${token}`);
    const pack = row.tournament.packages.find((p) => p.tier === row.tier);
    const emailed = !!row.sponsor.email && row.status === 'INVITED' && !!pack;
    if (emailed) {
      await this.mailer.send(
        sponsorInvitationMail(row.sponsor.email!, {
          club: row.tournament.organization.name,
          tournament: row.tournament.name,
          sponsor: row.sponsor.name,
          tier: row.tier,
          totalCents: registrationQuote(pack!.priceCents).totalCents,
          url,
        }),
      );
    }
    return { url, emailed };
  }

  /**
   * Paiement reçu (webhook) : montant, devise et mode vérifiés, le pack passe
   * « payé ». Rend la suite (emails) à lancer après la validation.
   */
  async settle(
    tx: Tx,
    session: SponsorPaidSession,
  ): Promise<(() => Promise<void>) | null> {
    const row = await tx.tournamentSponsor.findUnique({
      where: { id: session.sponsorshipId },
      include: {
        sponsor: true,
        tournament: { include: { organization: true } },
      },
    });
    if (!row || row.checkoutSessionId !== session.id) {
      this.logger.error(
        `Alerte paiement : session ${session.id} payée pour un pack sponsor inconnu ou remplacé (${session.sponsorshipId}).`,
      );
      return null;
    }
    const expected = (row.amountCents ?? 0) + (row.serviceFeeCents ?? 0);
    if (session.amountTotal !== expected || session.currency !== 'eur') {
      this.logger.error(
        `Alerte paiement : session ${session.id} (pack ${row.id}) reçu ${String(session.amountTotal)} ${String(session.currency)}, attendu ${expected} eur.`,
      );
      return null;
    }
    if (row.status === 'PAID') {
      if (row.paymentIntentId !== session.paymentIntent) {
        this.logger.error(
          `Alerte paiement : pack ${row.id} déjà payé, second paiement ${session.id} à rembourser par le club.`,
        );
      }
      return null;
    }
    const now = this.clock.now();
    await tx.tournamentSponsor.update({
      where: { id: row.id },
      data: {
        status: 'PAID',
        paidAt: now,
        paymentIntentId: session.paymentIntent,
      },
    });
    const owners = await tx.membership.findMany({
      where: {
        organizationId: row.tournament.organizationId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
      include: { user: { select: { email: true } } },
    });
    const receiptTo = session.email ?? row.sponsor.email;
    return async () => {
      const date = new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'long',
        timeZone: 'Europe/Paris',
      }).format(now);
      const info = {
        club: row.tournament.organization.name,
        tournament: row.tournament.name,
        sponsor: row.sponsor.name,
        tier: row.tier,
        amountCents: row.amountCents ?? 0,
        serviceFeeCents: row.serviceFeeCents ?? 0,
        date,
        url: this.appUrl(`/t/${row.tournament.slug}`),
      };
      if (receiptTo) {
        await this.mailer.send(sponsorReceiptMail(receiptTo, info));
      }
      for (const owner of owners) {
        await this.mailer.send(
          sponsorPaidClubMail(owner.user.email, {
            ...info,
            url: this.appUrl(
              `/organizer/sponsors?t=${encodeURIComponent(row.tournament.slug)}`,
            ),
          }),
        );
      }
    };
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
