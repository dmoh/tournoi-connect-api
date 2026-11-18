import { z } from 'zod';

const tierSchema = z.enum(['GOLD', 'SILVER', 'BRONZE', 'FIELD']);

/** Invitation d'un sponsor telle qu'il la voit (lien personnel, sans compte). */
export const sponsorInvitationSchema = z.object({
  tournament: z.object({
    slug: z.string(),
    name: z.string(),
    startsAt: z.iso.datetime({ offset: true }),
    city: z.string(),
  }),
  club: z.string(),
  sponsor: z.object({ name: z.string(), email: z.string().nullable() }),
  tier: tierSchema,
  /** Terrain sponsorisé, pour un pack FIELD. */
  field: z.string().nullable(),
  /** Prix du pack (versé au club), frais de service et total, en centimes. */
  priceCents: z.number().int(),
  serviceFeeCents: z.number().int(),
  totalCents: z.number().int(),
  status: z.enum(['INVITED', 'PAID']),
  paidAt: z.iso.datetime({ offset: true }).nullable(),
  /** Le club peut encaisser en ligne (compte Stripe actif). */
  paymentsReady: z.boolean(),
});

export const sponsorCheckoutSchema = z.object({
  /** Adresse du reçu de paiement. */
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});

export const checkoutUrlSchema = z.object({ url: z.url() });
export const inviteLinkSchema = z.object({
  url: z.url(),
  /** L'invitation est partie par email (le sponsor a une adresse). */
  emailed: z.boolean(),
});

export type SponsorInvitation = z.infer<typeof sponsorInvitationSchema>;
export type SponsorCheckout = z.infer<typeof sponsorCheckoutSchema>;
export type InviteLink = z.infer<typeof inviteLinkSchema>;
