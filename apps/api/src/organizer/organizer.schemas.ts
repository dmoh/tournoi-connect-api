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

export const sportSchema = z.enum([
  'football',
  'handball',
  'basketball',
  'volleyball',
  'rugby',
]);
export const formatSchema = z.enum([
  'single-group',
  'groups-knockout',
  'knockout',
  'swiss',
]);
const dateSchema = z.iso.date();
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

/** Tournoi de l'écran 01 « Tournois » (carte de l'organisateur). */
export const organizerTournamentSchema = z.object({
  slug: z.string(),
  name: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'IN_PROGRESS']),
  startsAt: z.iso.datetime({ offset: true }),
  city: z.string(),
  teamCount: z.number().int(),
  maxTeams: z.number().int(),
  sport: sportSchema,
  venueName: z.string(),
  categories: z.array(z.string()),
  fields: z.number().int(),
});

/**
 * Brouillon de l'assistant de création (écrans 02 à 05), publié d'un coup.
 * La ville arrive avec ses coordonnées (choisie dans la liste de la PWA),
 * pour la découverte par rayon.
 */
export const createTournamentSchema = z
  .object({
    name: z.string().trim().min(3).max(80),
    sport: sportSchema,
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    venueName: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(80),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    fields: z.number().int().min(1).max(20),
    outdoor: z.boolean(),
    categories: z.array(z.string().trim().min(1).max(20)).min(1).max(8),
    maxTeams: z.number().int().min(2).max(128),
    /** Prix par équipe en euros ; 0 = gratuit, 10 € minimum sinon (section 11). */
    feeEuros: z.number().min(0).max(500),
    registrationDeadline: dateSchema,
    format: formatSchema,
    matchMinutes: z.number().int().min(5).max(120),
    breakMinutes: z.number().int().min(0).max(60),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: 'La fin doit suivre le début.',
    path: ['endTime'],
  })
  .refine((v) => v.feeEuros === 0 || v.feeEuros >= 10, {
    message: '0 € (gratuit) ou 10 € minimum.',
    path: ['feeEuros'],
  })
  .refine((v) => v.registrationDeadline <= v.date, {
    message: 'La clôture doit précéder le tournoi.',
    path: ['registrationDeadline'],
  });

export type OrganizerTournament = z.infer<typeof organizerTournamentSchema>;
export type CreateTournament = z.infer<typeof createTournamentSchema>;

/**
 * Planning publié depuis l'écran 07 : pour chaque match à venir, son terrain
 * et son heure de début en minutes depuis minuit (heure de Paris), le jour du
 * match restant le même.
 */
export const scheduleSchema = z.object({
  slots: z
    .array(
      z.object({
        /** Identifiant court du match (« a5 »). */
        match: z.string().min(1).max(20),
        field: z.string().trim().min(1).max(40),
        minutes: z
          .number()
          .int()
          .min(0)
          .max(24 * 60 - 1),
      }),
    )
    .min(1)
    .max(500),
});

export const scheduleResultSchema = z.object({
  /** Matchs dont l'heure ou le terrain a changé. */
  updated: z.number().int(),
});

export type Schedule = z.infer<typeof scheduleSchema>;
export type ScheduleResult = z.infer<typeof scheduleResultSchema>;
