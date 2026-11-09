export interface Pairing<T> {
  /** Numéro de journée, à partir de 1. */
  round: number;
  home: T;
  away: T;
}

/**
 * Calendrier « toutes rondes » simple par la méthode du cercle.
 *
 * Fonction pure et déterministe : la même liste d'équipes donne toujours le
 * même calendrier. Avec un nombre impair d'équipes, une équipe est exempte à
 * chaque journée.
 */
export function generateRoundRobin<T>(teams: readonly T[]): Pairing<T>[] {
  if (new Set(teams).size !== teams.length) {
    throw new Error('Les équipes doivent être distinctes.');
  }
  if (teams.length < 2) {
    return [];
  }

  const BYE = Symbol('exempt');
  const slots: (T | typeof BYE)[] = [...teams];
  if (slots.length % 2 === 1) {
    slots.push(BYE);
  }

  const size = slots.length;
  const pairings: Pairing<T>[] = [];

  for (let round = 0; round < size - 1; round++) {
    for (let i = 0; i < size / 2; i++) {
      const a = slots[i] as T | typeof BYE;
      const b = slots[size - 1 - i] as T | typeof BYE;
      if (a === BYE || b === BYE) {
        continue;
      }
      // Alterner domicile et extérieur d'une journée à l'autre.
      const swap = round % 2 === 1;
      pairings.push({
        round: round + 1,
        home: swap ? b : a,
        away: swap ? a : b,
      });
    }
    // Rotation : la première équipe reste fixe, les autres tournent.
    slots.splice(1, 0, slots.pop() as T | typeof BYE);
  }

  return pairings;
}
