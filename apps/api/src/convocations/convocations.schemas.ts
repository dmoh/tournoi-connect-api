import { z } from 'zod';

/** Convocations d'un tournoi, vues par le club. */
export const convocationStatusSchema = z.object({
  /** Envoyées à cette date ; null : pas encore. */
  sentAt: z.iso.datetime({ offset: true }).nullable(),
  /** Envoi automatique prévu (48 h avant le début, 24 h sans tirage). */
  scheduledAt: z.iso.datetime({ offset: true }),
  /** Équipes inscrites dont le responsable reçoit la convocation. */
  recipients: z.number().int(),
  /** Faux pour un tournoi terminé, annulé ou en brouillon. */
  sendable: z.boolean(),
});

export const calendarQuerySchema = z.object({
  /** Code de l'équipe ; absent : le tournoi entier. */
  team: z.string().trim().min(1).max(40).optional(),
});

export type ConvocationStatus = z.infer<typeof convocationStatusSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
