import { z } from 'zod';

/**
 * Contrat des lectures publiques, calqué sur les modèles de la PWA
 * (src/app/core/api/models.ts). Aucune donnée personnelle ni financière privée.
 */
export const sportSchema = z.enum([
  'football',
  'handball',
  'basketball',
  'volleyball',
  'rugby',
]);
export const phaseSchema = z.enum([
  'groups',
  'round-of-32',
  'round-of-16',
  'quarter',
  'semi',
  'final',
]);
export const publicStatusSchema = z.enum([
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'COMPLETED',
]);

export const venueSchema = z.object({
  name: z.string(),
  city: z.string(),
  lat: z.number(),
  lng: z.number(),
  outdoor: z.boolean(),
});

export const tournamentSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  sport: sportSchema,
  organizer: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  venue: venueSchema,
  categories: z.array(z.string()),
  teamCount: z.number().int(),
  maxTeams: z.number().int(),
  feeCents: z.number().int(),
  status: publicStatusSchema,
});

export const nearbyTournamentSchema = tournamentSummarySchema.extend({
  distanceKm: z.number(),
});

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  club: z.string(),
  group: z.string().optional(),
});

export const matchSchema = z.object({
  id: z.string(),
  phase: phaseSchema,
  group: z.string().optional(),
  field: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  homeTeamId: z.string().nullable(),
  awayTeamId: z.string().nullable(),
  homePlaceholder: z.string().optional(),
  awayPlaceholder: z.string().optional(),
  scoreHome: z.number().int(),
  scoreAway: z.number().int(),
  status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED']),
  minute: z.number().int().optional(),
});

export const standingRowSchema = z.object({
  teamId: z.string(),
  played: z.number().int(),
  won: z.number().int(),
  drawn: z.number().int(),
  lost: z.number().int(),
  goalsFor: z.number().int(),
  goalsAgainst: z.number().int(),
  points: z.number().int(),
});

export const tournamentDetailSchema = tournamentSummarySchema.extend({
  teams: z.array(teamSchema),
  matches: z.array(matchSchema),
  standings: z.array(
    z.object({ group: z.string(), rows: z.array(standingRowSchema) }),
  ),
});

export const searchQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(200).default(25),
  sport: sportSchema.optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type TournamentSummary = z.infer<typeof tournamentSummarySchema>;
export type NearbyTournament = z.infer<typeof nearbyTournamentSchema>;
export type TournamentDetail = z.infer<typeof tournamentDetailSchema>;
