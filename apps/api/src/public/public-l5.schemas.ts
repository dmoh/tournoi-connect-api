import { z } from 'zod';

/** Sponsor affiché au public : jamais son e-mail ni son prix. */
export const sponsorCardSchema = z.object({
  /** Identifiant du sponsor sur ce tournoi, pour la mesure d'audience. */
  id: z.string(),
  name: z.string(),
  tier: z.enum(['GOLD', 'SILVER', 'BRONZE', 'FIELD']),
  website: z.url().optional(),
});

export const publicSponsorsSchema = z.object({
  /** Bannière exclusive du pack Or. */
  exclusive: sponsorCardSchema.nullable(),
  /** Bandeau partagé (Argent, Bronze), 6 logos au plus, en rotation. */
  rotation: z.array(sponsorCardSchema),
  /** Sponsor de chaque terrain (« Terrain 2 · présenté par … »). */
  fields: z.array(z.object({ field: z.string(), sponsor: sponsorCardSchema })),
});

export const pollOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  votes: z.number().int(),
});

export const pollResultSchema = z.object({
  options: z.array(pollOptionSchema),
});

export const newsItemSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('post'),
    id: z.string(),
    kind: z.enum(['announcement', 'result', 'poll']),
    publishedAt: z.iso.datetime({ offset: true }),
    title: z.string(),
    body: z.string(),
    matchId: z.string().optional(),
    poll: pollResultSchema.optional(),
  }),
  z.object({ type: z.literal('sponsored'), sponsor: sponsorCardSchema }),
]);

export const newsSchema = z.array(newsItemSchema);

export const voteSchema = z.object({ optionId: z.string().min(1) });

export const audienceEventSchema = z.object({
  sponsorId: z.string().min(1),
  placement: z.enum([
    'BANNER_EXCLUSIVE',
    'BANNER_ROTATION',
    'FIELD_LOGO',
    'FEED_CARD',
  ]),
  kind: z.enum(['impression', 'click']),
});

export type SponsorCard = z.infer<typeof sponsorCardSchema>;
export type PublicSponsors = z.infer<typeof publicSponsorsSchema>;
export type NewsItem = z.infer<typeof newsItemSchema>;
export type PollResult = z.infer<typeof pollResultSchema>;
export type AudienceEvent = z.infer<typeof audienceEventSchema>;
