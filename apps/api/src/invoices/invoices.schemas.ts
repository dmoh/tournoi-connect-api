import { z } from 'zod';
import { pageQuerySchema, pageSchema } from '../common/pagination.js';

/** Mention d'un club non assujetti, proposée par défaut (franchise en base). */
export const DEFAULT_VAT_NOTE = 'TVA non applicable, art. 293 B du CGI';
/** Taux de TVA d'un pack sponsor (prestation de publicité), en points de base. */
export const SPONSOR_VAT_RATE_BP = 2000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Identité légale du club, saisie par le propriétaire (PUT /organizer/billing). */
export const billingProfileInputSchema = z
  .object({
    legalName: z.string().trim().min(2).max(120),
    street: z.string().trim().min(3).max(200),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, 'Le code postal compte 5 chiffres.'),
    city: z.string().trim().min(1).max(80),
    siret: z
      .string()
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(z.string().regex(/^(\d{14})?$/, 'Le SIRET compte 14 chiffres.'))
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    rna: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(
        z
          .string()
          .regex(
            /^(W\d{9})?$/,
            'Le numéro RNA commence par W suivi de 9 chiffres.',
          ),
      )
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    vatRegistered: z.boolean(),
    vatNumber: z
      .string()
      .transform((v) => v.replace(/\s/g, '').toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            /^(FR[0-9A-Z]{2}\d{9})?$/,
            'Le numéro de TVA intracommunautaire s’écrit FR suivi de 11 caractères.',
          ),
      )
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    vatExemptionNote: optionalText(200),
  })
  .superRefine((value, ctx) => {
    if (!value.siret && !value.rna) {
      ctx.addIssue({
        code: 'custom',
        path: ['siret'],
        message: 'Indiquez le SIRET du club ou, à défaut, son numéro RNA.',
      });
    }
    if (value.vatRegistered && !value.vatNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['vatNumber'],
        message:
          'Un club assujetti à la TVA indique son numéro intracommunautaire.',
      });
    }
  });

/** Identité légale du club et prochain numéro de facture. */
export const billingProfileSchema = z.object({
  legalName: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  siret: z.string().nullable(),
  rna: z.string().nullable(),
  vatRegistered: z.boolean(),
  vatNumber: z.string().nullable(),
  vatExemptionNote: z.string(),
  /** Toutes les mentions obligatoires sont là : les factures peuvent partir. */
  complete: z.boolean(),
  /** Numéro de la prochaine facture (« FA-2026-0001 »). */
  nextNumber: z.string(),
});

/** Adresse de facturation du sponsor (saisie par le club pour un pack réglé directement). */
export const buyerAddressSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  street: z.string().trim().min(3).max(200),
  postalCode: z.string().trim().min(2).max(12),
  city: z.string().trim().min(1).max(80),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Pays en deux lettres (FR).')
    .default('FR'),
});

export const issueInvoiceSchema = z.object({
  /** Obligatoire si le sponsor n'a pas saisi d'adresse en payant en ligne. */
  buyer: buyerAddressSchema.optional(),
});

const sellerSchema = z.object({
  legalName: z.string(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  siret: z.string().nullable(),
  rna: z.string().nullable(),
  vatNumber: z.string().nullable(),
});

const buyerSchema = z.object({
  name: z.string(),
  street: z.string(),
  postalCode: z.string(),
  city: z.string(),
  country: z.string(),
  email: z.string().nullable(),
});

/** Facture telle que le club et le sponsor la consultent (et l'impriment). */
export const invoiceSchema = z.object({
  number: z.string(),
  issuedAt: z.iso.datetime({ offset: true }),
  paidAt: z.iso.datetime({ offset: true }),
  seller: sellerSchema,
  buyer: buyerSchema,
  /** Désignation : pack, terrain et tournoi. */
  label: z.string(),
  tournament: z.object({ slug: z.string(), name: z.string() }),
  netCents: z.number().int(),
  /** Taux de TVA en pourcentage (20), 0 pour un club non assujetti. */
  vatRate: z.number(),
  vatCents: z.number().int(),
  totalCents: z.number().int(),
  /** Mention d'exonération d'un club non assujetti, sinon null. */
  vatNote: z.string().nullable(),
  /** Payé en ligne (carte, Stripe) ou réglé directement au club. */
  paidOnline: z.boolean(),
});

export const invoiceSummarySchema = z.object({
  number: z.string(),
  issuedAt: z.iso.datetime({ offset: true }),
  sponsor: z.string(),
  tournament: z.string(),
  totalCents: z.number().int(),
});

export const invoicePageQuerySchema = pageQuerySchema;
export const invoicePageSchema = pageSchema(invoiceSummarySchema);

export type BillingProfileInput = z.infer<typeof billingProfileInputSchema>;
export type BillingProfile = z.infer<typeof billingProfileSchema>;
export type BuyerAddress = z.infer<typeof buyerAddressSchema>;
export type IssueInvoice = z.infer<typeof issueInvoiceSchema>;
export type InvoiceView = z.infer<typeof invoiceSchema>;
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;
