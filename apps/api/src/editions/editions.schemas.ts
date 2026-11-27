import { z } from 'zod';

/** Désinscription des invitations aux nouvelles éditions d'un club. */
export const editionOptOutSchema = z.object({
  club: z.string(),
  /** L'adresse ne reçoit plus les invitations du club. */
  optedOut: z.boolean(),
});

export type EditionOptOut = z.infer<typeof editionOptOutSchema>;
