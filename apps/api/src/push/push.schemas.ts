import { z } from 'zod';
import { isPushEndpoint } from './push-hosts.js';

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9-]+$/);
/** Équipe suivie : « slug-du-tournoi/code-equipe ». */
const teamKey = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[a-z0-9-]+\/[a-z0-9-]+$/);

export const followsSchema = z.object({
  tournaments: z.array(slug).max(200),
  teams: z.array(teamKey).max(200),
});

export const pushConfigSchema = z.object({
  /** Clé publique VAPID (base64url), ou null sans notifications. */
  publicKey: z.string().nullable(),
});

export const preferencesSchema = z.object({
  kickoff: z.boolean(),
  goals: z.boolean(),
  results: z.boolean(),
});

export const subscribeSchema = z.object({
  endpoint: z
    .url()
    .max(1000)
    .startsWith('https://')
    // Services push connus seulement (push-hosts.ts) : pas de requête vers un hôte arbitraire.
    .refine(isPushEndpoint, 'Service push du navigateur inconnu.'),
  keys: z.object({
    p256dh: z.string().regex(/^[\w-]{80,100}$/),
    auth: z.string().regex(/^[\w-]{16,30}$/),
  }),
  follows: followsSchema,
  preferences: preferencesSchema,
});

export const unsubscribeSchema = z.object({ endpoint: z.url().max(1000) });

export type Follows = z.infer<typeof followsSchema>;
export type Subscribe = z.infer<typeof subscribeSchema>;
export type Unsubscribe = z.infer<typeof unsubscribeSchema>;
export type PushConfig = z.infer<typeof pushConfigSchema>;

/** Notification de match, déposée dans la file du worker. */
export interface MatchNotification {
  kind: 'kickoff' | 'goal' | 'result';
  tournamentSlug: string;
  matchCode: string;
  homeTeam: string | null;
  awayTeam: string | null;
  title: string;
  body: string;
  /**
   * Identifiant de l'événement source (clientEventId du rapporteur) : rend
   * le dépôt dans la file idempotent. À défaut, le contenu en tient lieu.
   */
  eventId?: string;
}
