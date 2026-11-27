import { z } from 'zod';

const placementSchema = z.enum([
  'BANNER_EXCLUSIVE',
  'BANNER_ROTATION',
  'FIELD_LOGO',
  'FEED_CARD',
]);

/** Bilan d'un partenariat, ouvert par le lien personnel de l'email (sans connexion). */
export const sponsorReportSchema = z.object({
  club: z.string(),
  sponsor: z.string(),
  tier: z.enum(['BRONZE', 'SILVER', 'GOLD', 'FIELD']),
  field: z.string().nullable(),
  tournament: z.object({
    slug: z.string(),
    name: z.string(),
    startsAt: z.iso.datetime({ offset: true }),
    venue: z.string(),
  }),
  /** Affichages et clics de tout le tournoi. */
  impressions: z.number().int(),
  clicks: z.number().int(),
  /** Par emplacement, du plus vu au moins vu. */
  placements: z.array(
    z.object({
      placement: placementSchema,
      impressions: z.number().int(),
      clicks: z.number().int(),
    }),
  ),
  /** Équipes et matchs joués : l'ampleur du tournoi. */
  teams: z.number().int(),
  matches: z.number().int(),
});

export type SponsorReport = z.infer<typeof sponsorReportSchema>;
