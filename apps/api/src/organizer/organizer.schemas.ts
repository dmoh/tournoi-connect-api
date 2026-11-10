import { z } from 'zod';

export const tierSchema = z.enum(['GOLD', 'SILVER', 'BRONZE', 'FIELD']);
export const sponsorStatusSchema = z.enum(['PROSPECT', 'INVITED', 'PAID']);

export const sponsorRowSchema = z.object({
  id: z.string(),
  sponsorId: z.string(),
  name: z.string(),
  email: z.email().optional(),
  status: sponsorStatusSchema,
  tier: tierSchema,
  field: z.string().optional(),
  impressions: z.number().int(),
  clicks: z.number().int(),
});

export const organizerSponsorsSchema = z.object({
  packages: z.array(
    z.object({
      tier: tierSchema,
      priceCents: z.number().int(),
      inventory: z.number().int(),
      /** Packs réservés (invités ou payés). */
      taken: z.number().int(),
    }),
  ),
  sponsors: z.array(sponsorRowSchema),
  /** Sponsors du club pas encore invités sur ce tournoi (jamais affichés d'office). */
  prospects: z.array(
    z.object({ id: z.string(), name: z.string(), email: z.email().optional() }),
  ),
});

export const inviteSponsorSchema = z
  .object({
    /** Sponsor du carnet (prospect du club), ou un nouveau sponsor par son nom. */
    sponsorId: z.string().min(1).optional(),
    name: z.string().trim().min(2).max(80).optional(),
    email: z.email().optional(),
    tier: tierSchema,
    field: z.string().trim().min(1).max(40).optional(),
  })
  .refine((v) => Boolean(v.sponsorId) !== Boolean(v.name), {
    message: 'Indiquer un sponsor du carnet ou le nom d’un nouveau sponsor.',
  })
  .refine((v) => v.tier !== 'FIELD' || Boolean(v.field), {
    message: 'Un sponsor de terrain précise son terrain.',
    path: ['field'],
  });

export const updateSponsorSchema = z.object({
  status: z.enum(['INVITED', 'PAID']),
});

export const createPostSchema = z
  .object({
    kind: z.enum(['announcement', 'poll']),
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().max(1000).default(''),
    options: z.array(z.string().trim().min(1).max(60)).min(2).max(4).optional(),
  })
  .refine((v) => v.kind !== 'poll' || (v.options?.length ?? 0) >= 2, {
    message: 'Un sondage propose de 2 à 4 réponses.',
    path: ['options'],
  });

export const createdPostSchema = z.object({
  id: z.string(),
  publishedAt: z.iso.datetime({ offset: true }),
});

export type SponsorRow = z.infer<typeof sponsorRowSchema>;
export type OrganizerSponsors = z.infer<typeof organizerSponsorsSchema>;
export type InviteSponsor = z.infer<typeof inviteSponsorSchema>;
export type UpdateSponsor = z.infer<typeof updateSponsorSchema>;
export type CreatePost = z.infer<typeof createPostSchema>;
export type CreatedPost = z.infer<typeof createdPostSchema>;
