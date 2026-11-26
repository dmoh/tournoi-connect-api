import { z } from 'zod';

/** Lien « Nous sommes arrivés » d'une équipe (convocation, sans connexion). */
export const arrivalSchema = z.object({
  team: z.string(),
  tournament: z.object({
    slug: z.string(),
    name: z.string(),
    startsAt: z.iso.datetime({ offset: true }),
    venue: z.string(),
  }),
  /** Arrivée déjà signalée, à cette heure. */
  arrivedAt: z.iso.datetime({ offset: true }).nullable(),
  /** Jour J : de 4 h avant le début à la fin du tournoi. */
  open: z.boolean(),
});

/** Équipe du jour J, vue par le club : arrivée, forfait. */
export const matchdayTeamSchema = z.object({
  code: z.string(),
  name: z.string(),
  arrivedAt: z.iso.datetime({ offset: true }).nullable(),
  forfeit: z.boolean(),
  /** Premier match encore à jouer (heure), pour repérer les retards. */
  nextMatchAt: z.iso.datetime({ offset: true }).nullable(),
});

export const matchdaySchema = z.object({
  teams: z.array(matchdayTeamSchema),
  arrived: z.number().int(),
});

export const setArrivalSchema = z.object({ arrived: z.boolean() });

export const forfeitResultSchema = z.object({
  /** Matchs gagnés par l'adversaire sur forfait. */
  matches: z.number().int(),
});

export type Arrival = z.infer<typeof arrivalSchema>;
export type Matchday = z.infer<typeof matchdaySchema>;
export type SetArrival = z.infer<typeof setArrivalSchema>;
export type ForfeitResult = z.infer<typeof forfeitResultSchema>;
