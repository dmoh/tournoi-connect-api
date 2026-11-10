import { z } from 'zod';

/** Adresse nettoyée (espaces du remplissage automatique, majuscules). */
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const requestCodeSchema = z.object({ email });

export const verifyCodeSchema = z.object({
  email,
  code: z.string().regex(/^\d{6}$/, 'Le code compte 6 chiffres.'),
});

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
});

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  /** Prénom ou nom manquant : la PWA les demande une seule fois. */
  needsProfile: z.boolean(),
  providers: z.array(
    z.enum(['EMAIL', 'GOOGLE', 'APPLE', 'FACEBOOK', 'ECOCLUBSPORT']),
  ),
  memberships: z.array(
    z.object({
      organization: z.object({ slug: z.string(), name: z.string() }),
      role: z.enum(['OWNER', 'ADMIN', 'STAFF']),
    }),
  ),
  /** Accès exclusif aux statistiques d'un sponsor. */
  sponsors: z.array(
    z.object({ id: z.string(), name: z.string(), organization: z.string() }),
  ),
  platformAdmin: z.boolean(),
});

export const sessionSchema = z.object({
  accessToken: z.string(),
  /** Durée de validité du jeton d'accès, en secondes. */
  expiresIn: z.number().int(),
  user: meSchema,
});

export const providersSchema = z.object({
  providers: z.array(z.enum(['GOOGLE', 'APPLE', 'FACEBOOK'])),
});

export type RequestCode = z.infer<typeof requestCodeSchema>;
export type VerifyCode = z.infer<typeof verifyCodeSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Me = z.infer<typeof meSchema>;
export type SessionResponse = z.infer<typeof sessionSchema>;
