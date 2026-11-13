import { z } from 'zod';

/** Code de parrainage : 8 caractères sans 0/O, 1/I/L (dictés au téléphone sans erreur). */
export const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJKMNP-Z2-9]{8}$/, 'Code de parrainage invalide.');

export const referralSchema = z.object({
  code: z.string(),
  /** Lien à partager : création d'un club parrainé. */
  url: z.string(),
  clubs: z.array(
    z.object({
      name: z.string(),
      city: z.string().nullable(),
      joinedAt: z.iso.datetime({ offset: true }),
      /** Le club parrainé a publié au moins un tournoi. */
      active: z.boolean(),
    }),
  ),
});

export const publicReferralSchema = z.object({
  club: z.object({ name: z.string(), city: z.string().nullable() }),
});

export type Referral = z.infer<typeof referralSchema>;
export type PublicReferral = z.infer<typeof publicReferralSchema>;
