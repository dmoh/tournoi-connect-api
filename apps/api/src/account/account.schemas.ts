import { z } from 'zod';

const date = z.iso.datetime();
const role = z.enum(['OWNER', 'ADMIN', 'STAFF']);

/** Confirmation de la suppression : l'adresse du compte, saisie à nouveau. */
export const deleteAccountSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

/** Export des données du compte (RGPD, droit d'accès et portabilité). */
export const accountExportSchema = z.object({
  exportedAt: date,
  account: z.object({
    id: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    locale: z.string(),
    createdAt: date,
  }),
  identities: z.array(
    z.object({
      provider: z.enum([
        'EMAIL',
        'GOOGLE',
        'APPLE',
        'FACEBOOK',
        'ECOCLUBSPORT',
      ]),
      subject: z.string(),
      createdAt: date,
    }),
  ),
  sessions: z.array(
    z.object({
      userAgent: z.string().nullable(),
      createdAt: date,
      lastUsedAt: date,
      expiresAt: date,
      revokedAt: date.nullable(),
    }),
  ),
  memberships: z.array(
    z.object({
      organization: z.object({ slug: z.string(), name: z.string() }),
      role,
      createdAt: date,
    }),
  ),
  sponsorAccess: z.array(z.object({ sponsor: z.string(), createdAt: date })),
  invitationsSent: z.array(
    z.object({
      organization: z.string(),
      email: z.string(),
      role,
      createdAt: date,
      acceptedAt: date.nullable(),
      revokedAt: date.nullable(),
    }),
  ),
  registrations: z.array(
    z.object({
      id: z.string(),
      tournament: z.object({ slug: z.string(), name: z.string() }),
      teamName: z.string(),
      club: z.string(),
      managerName: z.string(),
      phone: z.string(),
      players: z.unknown(),
      status: z.enum([
        'PENDING_PAYMENT',
        'CONFIRMED',
        'WAITLISTED',
        'EXPIRED',
        'CANCELLED',
      ]),
      totalCents: z.number().int(),
      paidAt: date.nullable(),
      createdAt: date,
    }),
  ),
  follows: z.array(
    z.object({
      kind: z.enum(['TOURNAMENT', 'TEAM']),
      target: z.string(),
      createdAt: date,
    }),
  ),
  pushSubscriptions: z.array(
    z.object({
      /** Service de notifications du navigateur (origine seule). */
      service: z.string(),
      tournaments: z.array(z.string()),
      teams: z.array(z.string()),
      kickoff: z.boolean(),
      goals: z.boolean(),
      results: z.boolean(),
      createdAt: date,
      lastSentAt: date.nullable(),
    }),
  ),
  /** Photos envoyées depuis l'espace du club (retirées avec le compte). */
  photos: z.array(
    z.object({
      tournament: z.string(),
      url: z.string(),
      caption: z.string().nullable(),
      createdAt: date,
    }),
  ),
});

export type DeleteAccount = z.infer<typeof deleteAccountSchema>;
export type AccountExport = z.infer<typeof accountExportSchema>;
