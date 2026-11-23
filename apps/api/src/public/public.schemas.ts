import { z } from 'zod';
import { pageQuerySchema, pageSchema } from '../common/pagination.js';
import { rankingRulesSchema } from '../common/ranking-rules.schema.js';

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
  'third-place',
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
  /** Vainqueur aux tirs au but d'un match à élimination terminé sur un nul. */
  winner: z.enum(['home', 'away']).optional(),
});

export const standingRowSchema = z.object({
  teamId: z.string(),
  played: z.number().int(),
  won: z.number().int(),
  drawn: z.number().int(),
  lost: z.number().int(),
  goalsFor: z.number().int(),
  goalsAgainst: z.number().int(),
  /** Bonus défensifs (rugby), déjà comptés dans les points. */
  bonus: z.number().int(),
  points: z.number().int(),
});

export const tournamentDetailSchema = tournamentSummarySchema.extend({
  teams: z.array(teamSchema),
  matches: z.array(matchSchema),
  standings: z.array(
    z.object({ group: z.string(), rows: z.array(standingRowSchema) }),
  ),
  /** Règles du classement : celles du sport ou de l'organisateur. */
  rules: rankingRulesSchema,
});

/**
 * Explorer : point, rayon, sport, puis `cursor` et `limit`. Un curseur ne
 * vaut que pour les mêmes lat, lng, radiusKm et sport.
 */
export const searchQuerySchema = pageQuerySchema.extend({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(200).default(25),
  sport: sportSchema.optional(),
});

/** Page de l'Explorer, triée par (distance, début, id). */
export const nearbyPageSchema = pageSchema(nearbyTournamentSchema);

/** Journée de Paris (« 2026-11-09 ») des matchs à lire. */
export const dayQuerySchema = z.object({ day: z.iso.date().optional() });

/**
 * Matchs d'une journée de la page publique, regroupés par créneau (heure de
 * début) puis par phase ; `days` liste les journées du tournoi pour les
 * ancres partageables (`?day=`).
 */
export const dayMatchesSchema = z.object({
  /** Journée rendue (heure de Paris). */
  day: z.iso.date(),
  /** Toutes les journées qui ont des matchs, dans l'ordre. */
  days: z.array(z.iso.date()),
  previousDay: z.iso.date().nullable(),
  nextDay: z.iso.date().nullable(),
  slots: z.array(
    z.object({
      startsAt: z.iso.datetime({ offset: true }),
      phases: z.array(
        z.object({ phase: phaseSchema, matches: z.array(matchSchema) }),
      ),
    }),
  ),
});

/**
 * Score d'un match tel que le sonde la page publique : seulement ce qui bouge
 * pendant le direct, et la date du dernier événement enregistré (null sans
 * événement) pour savoir si le fil a changé.
 */
export const liveMatchSchema = matchSchema
  .pick({
    id: true,
    status: true,
    scoreHome: true,
    scoreAway: true,
    minute: true,
    winner: true,
  })
  .extend({
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
  });

/**
 * Direct d'un tournoi : matchs en cours et matchs terminés depuis moins de
 * 30 minutes, avec le statut du tournoi (le sondage s'arrête quand il est
 * terminé) et l'heure du serveur (`asOf`, « mis à jour il y a… »).
 */
export const tournamentLiveSchema = z.object({
  asOf: z.iso.datetime({ offset: true }),
  status: publicStatusSchema,
  matches: z.array(liveMatchSchema),
});

/** Direct d'un seul match (page du match), quel que soit son statut. */
export const matchLiveSchema = z.object({
  asOf: z.iso.datetime({ offset: true }),
  status: publicStatusSchema,
  match: liveMatchSchema,
});

/** Pages de tournoi à référencer (sitemap.xml de la PWA). */
export const sitemapSchema = z.object({
  tournaments: z.array(
    z.object({ slug: z.string(), endsAt: z.iso.datetime({ offset: true }) }),
  ),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type DayQuery = z.infer<typeof dayQuerySchema>;
export type DayMatches = z.infer<typeof dayMatchesSchema>;
export type PublicMatch = z.infer<typeof matchSchema>;
export type LiveMatch = z.infer<typeof liveMatchSchema>;
export type TournamentLive = z.infer<typeof tournamentLiveSchema>;
export type MatchLive = z.infer<typeof matchLiveSchema>;
export type Sitemap = z.infer<typeof sitemapSchema>;
export type TournamentSummary = z.infer<typeof tournamentSummarySchema>;
export type NearbyTournament = z.infer<typeof nearbyTournamentSchema>;
export type TournamentDetail = z.infer<typeof tournamentDetailSchema>;
