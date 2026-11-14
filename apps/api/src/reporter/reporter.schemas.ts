import { z } from 'zod';

const playerSchema = z.object({ number: z.number().int(), name: z.string() });

const reporterTeamSchema = z.object({
  name: z.string(),
  /** Monogramme affiché sur le bouton But. */
  shortName: z.string(),
  players: z.array(playerSchema),
});

export const reporterMatchSchema = z.object({
  token: z.string(),
  tournamentSlug: z.string(),
  tournamentName: z.string(),
  matchId: z.string(),
  phase: z.enum([
    'groups',
    'round-of-32',
    'round-of-16',
    'quarter',
    'semi',
    'final',
  ]),
  field: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  home: reporterTeamSchema,
  away: reporterTeamSchema,
  /** Durée réglementaire en minutes (format du tournoi), hors mi-temps. */
  matchMinutes: z.number().int(),
  status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED']),
});

export const reporterEventSchema = z
  .object({
    /** Créé sur l'appareil : un renvoi n'est compté qu'une fois. */
    clientEventId: z.string().min(8).max(64),
    type: z.enum([
      'GOAL',
      'YELLOW_CARD',
      'RED_CARD',
      'SAVE',
      'PHOTO',
      'HALF_TIME',
      'FULL_TIME',
      'CANCEL',
    ]),
    side: z.enum(['home', 'away']).optional(),
    minute: z.number().int().min(0).max(300),
    player: z.string().trim().min(1).max(60).optional(),
    assist: z.string().trim().min(1).max(60).optional(),
    caption: z.string().trim().min(1).max(140).optional(),
    /** Photo du match déjà envoyée et confirmée, pour PHOTO. */
    photoId: z.string().min(1).max(40).optional(),
    /** clientEventId de l'événement annulé, pour CANCEL. */
    cancels: z.string().min(8).max(64).optional(),
  })
  .refine((e) => e.type !== 'GOAL' || e.side !== undefined, {
    message: 'Un but indique son équipe.',
    path: ['side'],
  })
  .refine((e) => e.photoId === undefined || e.type === 'PHOTO', {
    message: 'Seul un événement photo porte une photo.',
    path: ['photoId'],
  })
  .refine((e) => e.type !== 'CANCEL' || e.cancels !== undefined, {
    message: 'Une annulation indique l’événement annulé.',
    path: ['cancels'],
  });

export const reporterStateSchema = z.object({
  score: z.object({ home: z.number().int(), away: z.number().int() }),
  status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED']),
});

export const reporterLinkSchema = z.object({
  token: z.string(),
  url: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type ReporterMatch = z.infer<typeof reporterMatchSchema>;
export type ReporterEvent = z.infer<typeof reporterEventSchema>;
export type ReporterState = z.infer<typeof reporterStateSchema>;
export type ReporterLink = z.infer<typeof reporterLinkSchema>;
