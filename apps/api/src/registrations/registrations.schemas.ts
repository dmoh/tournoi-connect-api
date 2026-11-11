import { z } from 'zod';
import { tournamentSummarySchema } from '../public/public.schemas.js';

export const playerSchema = z.object({
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(40),
  /** Numéro de maillot, facultatif (« » ou 1 à 999). */
  number: z
    .string()
    .trim()
    .regex(/^\d{0,3}$/)
    .default(''),
});

/** Formulaire d'inscription (écran 08) ; l'email est celui du compte connecté. */
export const registerSchema = z.object({
  teamName: z.string().trim().min(2).max(60),
  club: z.string().trim().max(80).default(''),
  managerName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(30),
  players: z.array(playerSchema).min(1).max(30),
  acceptRules: z.literal(true),
});

export const quoteSchema = z.object({
  feeCents: z.number().int(),
  /** Frais de service de la plateforme, payés par l'équipe. */
  serviceFeeCents: z.number().int(),
  totalCents: z.number().int(),
});

export const registrationInviteSchema = z.object({
  code: z.string(),
  tournament: tournamentSummarySchema,
  quote: quoteSchema,
  /** Inscriptions ouvertes (statut et date de clôture). */
  open: z.boolean(),
  /** Plus de place : une inscription part en liste d'attente. */
  full: z.boolean(),
  /** Gratuit, ou paiements activés par le club. */
  paymentsReady: z.boolean(),
});

export const registrationStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'WAITLISTED',
  'EXPIRED',
  'CANCELLED',
]);

export const registrationSchema = z.object({
  orderId: z.string(),
  code: z.string(),
  tournamentSlug: z.string(),
  tournamentName: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  teamName: z.string(),
  status: registrationStatusSchema,
  quote: quoteSchema,
  waitlistPosition: z.number().int().optional(),
  /** Page de paiement Stripe, tant que la place est tenue. */
  checkoutUrl: z.url().optional(),
  /** Fin de la place tenue pendant le paiement. */
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const organizerRegistrationSchema = z.object({
  id: z.string(),
  teamName: z.string(),
  club: z.string(),
  managerName: z.string(),
  /** Vide quand le responsable a supprimé son compte. */
  email: z.string().nullable(),
  phone: z.string(),
  players: z.number().int(),
  status: registrationStatusSchema,
  totalCents: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const paymentsStatusSchema = z.object({
  /** Paiements configurés sur la plateforme (clé Stripe). */
  available: z.boolean(),
  /** Compte Stripe du club créé. */
  connected: z.boolean(),
  /** Le club peut encaisser (vérification Stripe terminée). */
  chargesEnabled: z.boolean(),
});

export const onboardingSchema = z.object({ url: z.url() });

export type Register = z.infer<typeof registerSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type RegistrationInvite = z.infer<typeof registrationInviteSchema>;
export type RegistrationView = z.infer<typeof registrationSchema>;
export type OrganizerRegistration = z.infer<typeof organizerRegistrationSchema>;
export type PaymentsStatus = z.infer<typeof paymentsStatusSchema>;
