import {
  TIEBREAKERS,
  validateRules,
  type RankingRules,
} from '@dmoh/tournoi-connect-engine';
import { z } from 'zod';

const points = z.number().int().min(0).max(10);

/**
 * Règles de classement d'un tournoi (moteur) : points par résultat, bonus
 * défensif éventuel, ordre des critères de départage. Les points passent
 * toujours en premier ; le nom départage en dernier.
 */
export const rankingRulesSchema = z
  .object({
    points: z.object({ win: points, draw: points, loss: points }),
    losingBonus: z
      .object({
        margin: z.number().int().min(1).max(50),
        points: z.number().int().min(1).max(5),
      })
      .nullable(),
    tiebreakers: z.array(z.enum(TIEBREAKERS)).max(TIEBREAKERS.length),
  })
  .superRefine((rules, ctx) => {
    for (const message of validateRules(rules)) {
      ctx.addIssue({ code: 'custom', message });
    }
  });

/** Règles lues en base : null (règles du sport) si absentes ou illisibles. */
export function storedRules(value: unknown): RankingRules | null {
  const parsed = rankingRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
