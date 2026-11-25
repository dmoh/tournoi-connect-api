import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { Clock } from '../common/clock.js';
import {
  decodeCursor,
  encodeCursor,
  takePage,
  type Page,
  type PageQuery,
} from '../common/pagination.js';
import { parisDate } from '../common/paris-time.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  Invoice,
  Organization,
  Prisma,
} from '../generated/prisma/client.js';
import { Mailer } from '../mail/mailer.js';
import { sponsorInvoiceMail } from '../mail/templates.js';
import {
  DEFAULT_VAT_NOTE,
  SPONSOR_VAT_RATE_BP,
  type BillingProfile,
  type BillingProfileInput,
  type BuyerAddress,
  type InvoiceSummary,
  type InvoiceView,
} from './invoices.schemas.js';

type Tx = Prisma.TransactionClient;

/** Empreinte du lien de la facture : seule elle est gardée en base. */
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

const TIER_NAME = {
  GOLD: 'Or',
  SILVER: 'Argent',
  BRONZE: 'Bronze',
  FIELD: 'Terrain',
} as const;

/** Adresse de facturation gardée sur le pack (saisie sur Stripe ou par le club). */
const storedAddressSchema = z.object({
  name: z.string().nullable().optional(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  country: z.string(),
});
type StoredAddress = z.infer<typeof storedAddressSchema>;

const sellerSnapshot = z.object({
  legalName: z.string(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  siret: z.string().nullable(),
  rna: z.string().nullable(),
  vatNumber: z.string().nullable(),
  vatNote: z.string().nullable(),
});
const buyerSnapshot = z.object({
  name: z.string(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  country: z.string(),
  email: z.string().nullable(),
});

/** Facture émise : la facture et le lien à envoyer au sponsor. */
export interface IssuedInvoice {
  invoice: Invoice;
  url: string;
  /** Adresse où envoyer la facture (sponsor ou adresse saisie au paiement). */
  email: string | null;
  club: string;
  tournament: string;
}

/**
 * Factures des packs sponsors, émises au nom du club (le vendeur). Le club
 * renseigne son identité légale ; chaque pack payé reçoit alors une facture
 * numérotée dans une suite continue propre au club, figée à l'émission et
 * consultable par le sponsor avec un lien personnel.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async profile(organizationSlug: string): Promise<BillingProfile> {
    return toProfile(
      await this.organization(organizationSlug),
      this.clock.now(),
    );
  }

  async updateProfile(
    organizationSlug: string,
    input: BillingProfileInput,
  ): Promise<BillingProfile> {
    const organization = await this.organization(organizationSlug);
    const updated = await this.prisma.organization.update({
      where: { id: organization.id },
      data: {
        legalName: input.legalName,
        billingStreet: input.street,
        billingPostalCode: input.postalCode,
        billingCity: input.city,
        siret: input.siret ?? null,
        rna: input.rna ?? null,
        vatRegistered: input.vatRegistered,
        vatNumber: input.vatRegistered ? (input.vatNumber ?? null) : null,
        vatExemptionNote: input.vatRegistered
          ? null
          : (input.vatExemptionNote ?? null),
      },
    });
    return toProfile(updated, this.clock.now());
  }

  /**
   * Émet la facture d'un pack payé, dans la transaction de l'appelant : le
   * numéro suit le dernier du club (ligne verrouillée par l'incrément, sans
   * trou même en cas d'échec). Null si l'identité du club ou l'adresse du
   * sponsor manquent ; la facture déjà émise si elle existe.
   */
  async issue(
    tx: Tx,
    tournamentSponsorId: string,
    buyerInput?: BuyerAddress,
  ): Promise<IssuedInvoice | null> {
    const row = await tx.tournamentSponsor.findUnique({
      where: { id: tournamentSponsorId },
      include: {
        sponsor: true,
        invoice: true,
        tournament: { include: { organization: true, packages: true } },
      },
    });
    if (!row || row.status !== 'PAID' || row.invoice) {
      return null;
    }
    const organization = row.tournament.organization;
    if (!isComplete(organization)) {
      return null;
    }
    const stored = storedAddressSchema.safeParse(row.billingAddress);
    const address: StoredAddress | null = buyerInput
      ? { ...buyerInput, name: buyerInput.name ?? null }
      : stored.success
        ? stored.data
        : null;
    if (!address) {
      return null;
    }
    if (buyerInput) {
      await tx.tournamentSponsor.update({
        where: { id: row.id },
        data: { billingAddress: address },
      });
    }
    const totalCents =
      row.amountCents ??
      row.tournament.packages.find((p) => p.tier === row.tier)?.priceCents ??
      0;
    const vatRateBp = organization.vatRegistered ? SPONSOR_VAT_RATE_BP : 0;
    // Prix du pack TTC : la TVA en est extraite.
    const netCents = Math.round((totalCents * 10_000) / (10_000 + vatRateBp));
    const now = this.clock.now();
    const { invoiceSequence: sequence } = await tx.organization.update({
      where: { id: organization.id },
      data: { invoiceSequence: { increment: 1 } },
      select: { invoiceSequence: true },
    });
    const token = randomBytes(24).toString('base64url');
    const invoice = await tx.invoice.create({
      data: {
        organizationId: organization.id,
        tournamentSponsorId: row.id,
        sequence,
        number: invoiceNumber(now, sequence),
        issuedAt: now,
        paidAt: row.paidAt ?? now,
        seller: {
          legalName: organization.legalName!,
          street: organization.billingStreet!,
          postalCode: organization.billingPostalCode!,
          city: organization.billingCity!,
          siret: organization.siret,
          rna: organization.rna,
          vatNumber: organization.vatRegistered ? organization.vatNumber : null,
          vatNote: organization.vatRegistered
            ? null
            : (organization.vatExemptionNote ?? DEFAULT_VAT_NOTE),
        },
        buyer: {
          name: address.name || row.sponsor.name,
          street: address.street,
          postalCode: address.postalCode,
          city: address.city,
          country: address.country,
          email: row.sponsor.email,
        },
        label: `Pack partenaire ${TIER_NAME[row.tier]}${row.field ? ` (${row.field})` : ''} · ${row.tournament.name} du ${frenchDate(row.tournament.startsAt)}`,
        netCents,
        vatRateBp,
        vatCents: totalCents - netCents,
        totalCents,
        paymentIntentId: row.paymentIntentId,
        accessTokenHash: hashToken(token),
      },
    });
    return {
      invoice,
      url: this.appUrl(`/facture/${token}`),
      email: row.sponsor.email,
      club: organization.name,
      tournament: row.tournament.name,
    };
  }

  /** Envoi de la facture au sponsor (après la transaction qui l'a émise). */
  async send(issued: IssuedInvoice, to = issued.email): Promise<boolean> {
    if (!to) {
      return false;
    }
    await this.mailer.send(
      sponsorInvoiceMail(to, {
        club: issued.club,
        tournament: issued.tournament,
        number: issued.invoice.number,
        totalCents: issued.invoice.totalCents,
        url: issued.url,
      }),
    );
    return true;
  }

  /**
   * Facture d'un pack payé, établie par un administrateur du club (pack payé
   * avant que l'identité du club soit complète, ou réglé directement au
   * club). 404 hors du club, 409 si le pack n'est pas payé, l'identité du club
   * incomplète ou l'adresse du sponsor inconnue.
   */
  async issueForClub(
    organizationSlug: string,
    tournamentSponsorId: string,
    buyer?: BuyerAddress,
  ): Promise<InvoiceView> {
    const row = await this.prisma.tournamentSponsor.findFirst({
      where: {
        id: tournamentSponsorId,
        tournament: { organization: { slug: organizationSlug } },
      },
      include: {
        invoice: true,
        tournament: { include: { organization: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Sponsor introuvable.');
    }
    if (row.invoice) {
      return this.view(row.invoice);
    }
    if (row.status !== 'PAID') {
      throw new ConflictException('Seul un pack payé reçoit une facture.');
    }
    if (!isComplete(row.tournament.organization)) {
      throw new ConflictException(
        'Complétez d’abord l’identité de facturation du club.',
      );
    }
    if (!buyer && !storedAddressSchema.safeParse(row.billingAddress).success) {
      throw new ConflictException(
        'Indiquez l’adresse de facturation du sponsor.',
      );
    }
    const issued = await this.prisma.$transaction((tx) =>
      this.issue(tx, row.id, buyer),
    );
    if (!issued) {
      throw new ConflictException('La facture n’a pas pu être émise.');
    }
    await this.send(issued);
    return this.view(issued.invoice);
  }

  async list(
    organizationSlug: string,
    query: PageQuery,
  ): Promise<Page<InvoiceSummary>> {
    const organization = await this.organization(organizationSlug);
    const before = query.cursor
      ? decodeCursor(query.cursor, 'invoices', z.tuple([z.number().int()]))[0]
      : null;
    const rows = await this.prisma.invoice.findMany({
      where: {
        organizationId: organization.id,
        ...(before === null ? {} : { sequence: { lt: before } }),
      },
      include: {
        tournamentSponsor: {
          include: { tournament: { select: { name: true } } },
        },
      },
      orderBy: { sequence: 'desc' },
      take: query.limit + 1,
    });
    const page = takePage(rows, query.limit, (r) =>
      encodeCursor('invoices', [r.sequence]),
    );
    return {
      items: page.rows.map((r) => ({
        number: r.number,
        issuedAt: r.issuedAt.toISOString(),
        sponsor: buyerSnapshot.parse(r.buyer).name,
        tournament: r.tournamentSponsor.tournament.name,
        totalCents: r.totalCents,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async get(organizationSlug: string, number: string): Promise<InvoiceView> {
    const organization = await this.organization(organizationSlug);
    const invoice = await this.prisma.invoice.findUnique({
      where: {
        organizationId_number: { organizationId: organization.id, number },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Facture introuvable.');
    }
    return this.view(invoice);
  }

  /** Facture consultée par le sponsor avec son lien personnel. */
  async byToken(token: string): Promise<InvoiceView> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { accessTokenHash: hashToken(token) },
    });
    if (!invoice) {
      throw new NotFoundException('Facture introuvable.');
    }
    return this.view(invoice);
  }

  private async view(invoice: Invoice): Promise<InvoiceView> {
    const row = await this.prisma.tournamentSponsor.findUniqueOrThrow({
      where: { id: invoice.tournamentSponsorId },
      select: { tournament: { select: { slug: true, name: true } } },
    });
    const seller = sellerSnapshot.parse(invoice.seller);
    return {
      number: invoice.number,
      issuedAt: invoice.issuedAt.toISOString(),
      paidAt: invoice.paidAt.toISOString(),
      seller: {
        legalName: seller.legalName,
        street: seller.street,
        postalCode: seller.postalCode,
        city: seller.city,
        siret: seller.siret,
        rna: seller.rna,
        vatNumber: seller.vatNumber,
      },
      buyer: buyerSnapshot.parse(invoice.buyer),
      label: invoice.label,
      tournament: row.tournament,
      netCents: invoice.netCents,
      vatRate: invoice.vatRateBp / 100,
      vatCents: invoice.vatCents,
      totalCents: invoice.totalCents,
      vatNote: seller.vatNote,
      paidOnline: invoice.paymentIntentId !== null,
    };
  }

  private async organization(slug: string): Promise<Organization> {
    const organization = await this.prisma.organization.findUnique({
      where: { slug },
    });
    if (!organization) {
      throw new NotFoundException('Club introuvable.');
    }
    return organization;
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}

/** Toutes les mentions du vendeur sont renseignées. */
export function isComplete(o: Organization): boolean {
  return (
    !!o.legalName &&
    !!o.billingStreet &&
    !!o.billingPostalCode &&
    !!o.billingCity &&
    (!!o.siret || !!o.rna) &&
    (!o.vatRegistered || !!o.vatNumber)
  );
}

/** « FA-2026-0042 » : année d'émission (heure de Paris) et rang dans la suite. */
export function invoiceNumber(issuedAt: Date, sequence: number): string {
  return `FA-${parisDate(issuedAt).slice(0, 4)}-${String(sequence).padStart(4, '0')}`;
}

function frenchDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'long',
    timeZone: 'Europe/Paris',
  }).format(date);
}

function toProfile(o: Organization, now: Date): BillingProfile {
  return {
    legalName: o.legalName,
    street: o.billingStreet,
    postalCode: o.billingPostalCode,
    city: o.billingCity,
    siret: o.siret,
    rna: o.rna,
    vatRegistered: o.vatRegistered,
    vatNumber: o.vatNumber,
    vatExemptionNote: o.vatExemptionNote ?? DEFAULT_VAT_NOTE,
    complete: isComplete(o),
    nextNumber: invoiceNumber(now, o.invoiceSequence + 1),
  };
}
