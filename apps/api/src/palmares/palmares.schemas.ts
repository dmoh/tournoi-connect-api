import { z } from 'zod';

/** Palmarès public d'un tournoi : podium une fois tout joué, meilleurs buteurs. */
export const palmaresSchema = z.object({
  /** Le podium est connu : finale (et petite finale) ou classement final joués. */
  complete: z.boolean(),
  /** Équipes du podium (identifiants courts) ; null tant que le tournoi se joue. */
  podium: z
    .object({
      first: z.string(),
      second: z.string().nullable(),
      /** Une équipe (petite finale ou classement), deux ex aequo sans petite finale. */
      third: z.array(z.string()),
    })
    .nullable(),
  /** Dix meilleurs buteurs, saisis par la table de marque (buts annulés exclus). */
  scorers: z.array(
    z.object({
      teamId: z.string(),
      player: z.string(),
      goals: z.number().int(),
    }),
  ),
});

export type Palmares = z.infer<typeof palmaresSchema>;
