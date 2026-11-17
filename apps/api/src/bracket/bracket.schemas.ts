import { z } from 'zod';

/** Tirage demandé : graine facultative (sinon tirée au hasard et gardée). */
export const drawRequestSchema = z.object({
  seed: z.string().trim().min(1).max(40).optional(),
});

const drawTeamSchema = z.object({ code: z.string(), name: z.string() });

/** Tirage d'un tournoi tel que l'organisateur le voit. */
export const drawSchema = z.object({
  format: z.enum(['single-group', 'groups-knockout', 'knockout', 'swiss']),
  /** Équipes inscrites (inscriptions confirmées). */
  teams: z.array(drawTeamSchema),
  /** Graine du dernier tirage ; null s'il n'y en a pas eu. */
  seed: z.string().nullable(),
  /** Un match commencé fige le tirage. */
  started: z.boolean(),
  groups: z.array(
    z.object({ group: z.string(), teams: z.array(drawTeamSchema) }),
  ),
  matches: z.number().int(),
  /** Fin prévue du dernier match, null sans calendrier. */
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  /** Minutes au-delà de l'heure de fin du tournoi (0 si le calendrier tient). */
  overrunMinutes: z.number().int(),
});

export const winnerSchema = z.object({ side: z.enum(['home', 'away']) });

export type DrawRequest = z.infer<typeof drawRequestSchema>;
export type DrawView = z.infer<typeof drawSchema>;
export type WinnerInput = z.infer<typeof winnerSchema>;
