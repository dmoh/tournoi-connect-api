/** Sports gérés par le moteur (même liste que l'API). */
export type Sport =
  'football' | 'handball' | 'basketball' | 'volleyball' | 'rugby';

/** Points attribués par match de poule. */
export interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

/**
 * Bonus défensif (rugby) : une défaite par au plus `margin` points en
 * rapporte `points` de plus.
 */
export interface LosingBonus {
  margin: number;
  points: number;
}

/**
 * Critères de départage entre équipes à égalité de points, dans l'ordre :
 * - headToHead : mini-classement des seuls matchs entre les équipes à égalité
 *   (points, puis différence, puis marqués) ;
 * - difference : différence générale (buts, points ou sets marqués − encaissés) ;
 * - scored : total marqué ;
 * - wins : nombre de victoires ;
 * - conceded : le moins encaissé.
 * Le nom départage en dernier (ordre stable), jamais un tirage au sort.
 */
export const TIEBREAKERS = [
  'headToHead',
  'difference',
  'scored',
  'wins',
  'conceded',
] as const;
export type Tiebreaker = (typeof TIEBREAKERS)[number];

export interface RankingRules {
  points: PointsRule;
  losingBonus: LosingBonus | null;
  tiebreakers: readonly Tiebreaker[];
}

/**
 * Règles par défaut de chaque sport, inspirées des fédérations françaises
 * (FFF, FFHB, FFBB, FFVB, FFR) et ajustables par l'organisateur :
 * - football 3-1-0 ; handball 3-2-1 ; basket 2-1-1 (pas de nul au basket :
 *   le nul compte comme une défaite s'il arrive faute de prolongation) ;
 * - volley : le score d'un match est en sets, 3 points la victoire ;
 * - rugby 4-2-0 et bonus défensif d'un point pour une défaite de 7 points
 *   ou moins.
 */
export const SPORT_RULES: Record<Sport, RankingRules> = {
  football: {
    points: { win: 3, draw: 1, loss: 0 },
    losingBonus: null,
    tiebreakers: ['headToHead', 'difference', 'scored'],
  },
  handball: {
    points: { win: 3, draw: 2, loss: 1 },
    losingBonus: null,
    tiebreakers: ['headToHead', 'difference', 'scored'],
  },
  basketball: {
    points: { win: 2, draw: 1, loss: 1 },
    losingBonus: null,
    tiebreakers: ['headToHead', 'difference', 'scored'],
  },
  volleyball: {
    points: { win: 3, draw: 1, loss: 0 },
    losingBonus: null,
    tiebreakers: ['wins', 'difference', 'scored'],
  },
  rugby: {
    points: { win: 4, draw: 2, loss: 0 },
    losingBonus: { margin: 7, points: 1 },
    tiebreakers: ['headToHead', 'difference', 'scored'],
  },
};

/**
 * Score d'un match perdu par forfait, pour le vainqueur (le forfait marque
 * 0), selon les usages des fédérations françaises : 3-0 au football, 10-0
 * au handball, 20-0 au basket, 2-0 en sets au volley (format court), 25-0
 * au rugby. Le classement le compte comme une défaite.
 */
export const FORFEIT_SCORE: Record<Sport, number> = {
  football: 3,
  handball: 10,
  basketball: 20,
  volleyball: 2,
  rugby: 25,
};

/** Règles d'un tournoi : celles du sport, sauf réglage de l'organisateur. */
export function rulesFor(
  sport: Sport,
  custom?: RankingRules | null,
): RankingRules {
  return custom ?? SPORT_RULES[sport];
}

/** Raisons pour lesquelles des règles sont refusées (aucune : règles valides). */
export function validateRules(rules: RankingRules): string[] {
  const errors: string[] = [];
  const { win, draw, loss } = rules.points;
  if (
    ![win, draw, loss].every((p) => Number.isInteger(p) && p >= 0 && p <= 10)
  ) {
    errors.push('Les points sont des entiers de 0 à 10.');
  }
  if (!(win > draw && draw >= loss)) {
    errors.push(
      'Une victoire rapporte plus qu’un nul, un nul au moins autant qu’une défaite.',
    );
  }
  if (rules.losingBonus) {
    const { margin, points } = rules.losingBonus;
    if (!Number.isInteger(margin) || margin < 1 || margin > 50) {
      errors.push('L’écart du bonus défensif va de 1 à 50.');
    }
    if (!Number.isInteger(points) || points < 1 || loss + points >= win) {
      errors.push('Le bonus défensif ne vaut pas une victoire.');
    }
  }
  if (new Set(rules.tiebreakers).size !== rules.tiebreakers.length) {
    errors.push('Chaque critère de départage n’apparaît qu’une fois.');
  }
  if (rules.tiebreakers.some((t) => !TIEBREAKERS.includes(t))) {
    errors.push('Critère de départage inconnu.');
  }
  return errors;
}
