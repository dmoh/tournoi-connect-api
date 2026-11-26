import { z } from 'zod';
import { organizerRegistrationSchema } from './registrations.schemas.js';

/** Désister une équipe : rembourser ou non son paiement en ligne. */
export const withdrawSchema = z.object({ refund: z.boolean() });

export const withdrawResultSchema = z.object({
  registration: organizerRegistrationSchema,
  /** Le tirage comprenait l'équipe : il est défait, à refaire. */
  drawReset: z.boolean(),
});

/** Annuler le tournoi : motif affiché sur la page publique et dans les emails. */
export const cancelTournamentSchema = z.object({
  reason: z.string().trim().min(5).max(300),
});

const refundsSchema = z.object({
  count: z.number().int(),
  totalCents: z.number().int(),
});

/** Avant de confirmer : ce que l'annulation annule et rembourse. */
export const cancellationPreviewSchema = z.object({
  /** Faux pour un tournoi terminé, archivé ou déjà annulé. */
  cancellable: z.boolean(),
  status: z.enum([
    'DRAFT',
    'PUBLISHED',
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'IN_PROGRESS',
    'COMPLETED',
    'ARCHIVED',
    'CANCELLED',
  ]),
  /** Inscriptions actives (inscrites, en paiement, en liste d'attente). */
  registrations: z.number().int(),
  refunds: refundsSchema,
  /** Packs sponsors payés : à régler directement avec les sponsors. */
  sponsorsPaid: z.number().int(),
});

export const cancellationResultSchema = z.object({
  slug: z.string(),
  status: z.literal('CANCELLED'),
  cancelledAt: z.iso.datetime({ offset: true }),
  reason: z.string(),
  registrations: z.number().int(),
  refunds: refundsSchema,
});

export type Withdraw = z.infer<typeof withdrawSchema>;
export type WithdrawResult = z.infer<typeof withdrawResultSchema>;
export type CancelTournament = z.infer<typeof cancelTournamentSchema>;
export type CancellationPreview = z.infer<typeof cancellationPreviewSchema>;
export type CancellationResult = z.infer<typeof cancellationResultSchema>;
