import { describe, expect, it } from 'vitest';
import { FORFEIT_SCORE, SPORT_RULES } from './rules.js';

describe('FORFEIT_SCORE', () => {
  it('donne un score de forfait à chaque sport, toujours une victoire nette', () => {
    for (const sport of Object.keys(
      SPORT_RULES,
    ) as (keyof typeof SPORT_RULES)[]) {
      expect(FORFEIT_SCORE[sport]).toBeGreaterThan(0);
    }
    expect(FORFEIT_SCORE.football).toBe(3);
  });
});
