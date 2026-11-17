import { generateRoundRobin } from './round-robin.js';

/** Phases d'un tournoi (mêmes valeurs que l'API). */
export type Phase =
  | 'groups'
  | 'round_of_32'
  | 'round_of_16'
  | 'quarter'
  | 'semi'
  | 'third_place'
  | 'final';

/**
 * Origine d'une place de match encore inconnue :
 * - « group:A:1 » : 1er de la poule A, une fois toute la poule jouée ;
 * - « winner:df1 » / « loser:df1 » : vainqueur ou perdant d'un match.
 */
export type Source = string;

export interface PlannedMatch {
  code: string;
  phase: Phase;
  group: string | null;
  /** Ordre de jeu : journée de poule, puis tour du tableau final. */
  round: number;
  homeTeam: string | null;
  awayTeam: string | null;
  homeSource: Source | null;
  awaySource: Source | null;
}

export type FormatKind = 'single-group' | 'groups-knockout' | 'knockout';

export interface DrawInput {
  format: FormatKind;
  /** Codes des équipes inscrites, dans n'importe quel ordre. */
  teams: readonly string[];
  /** Graine du tirage : la même graine donne toujours le même tirage. */
  seed: string;
  /** Taille visée des poules (« poules + phase finale »), 4 par défaut. */
  groupSize?: number;
}

export interface Draw {
  groups: { group: string; teams: string[] }[];
  matches: PlannedMatch[];
}

/** Au-delà, le tableau final dépasserait les seizièmes. */
export const MAX_BRACKET = 32;

/**
 * Tirage et calendrier d'un tournoi, sans les horaires : poules tirées au
 * sort (serpentin sur un ordre mélangé par la graine), matchs de poule en
 * toutes rondes, puis tableau final dont les places viennent des poules ou
 * des matchs précédents. Fonction pure et déterministe.
 */
export function drawTournament(input: DrawInput): Draw {
  const teams = [...new Set(input.teams)];
  if (teams.length < 2) {
    throw new Error('Il faut au moins deux équipes.');
  }
  const order = shuffle([...teams].sort(), input.seed);
  switch (input.format) {
    case 'single-group': {
      const groups = [{ group: 'A', teams: order }];
      return { groups, matches: groupMatches(groups) };
    }
    case 'knockout': {
      if (teams.length > MAX_BRACKET) {
        throw new Error(
          `Élimination directe : ${MAX_BRACKET} équipes au plus.`,
        );
      }
      return {
        groups: [],
        matches: bracket(
          order.map((team) => ({ team })),
          false,
          1,
        ),
      };
    }
    case 'groups-knockout': {
      const size = input.groupSize ?? 4;
      // Même calcul que l'aperçu de l'assistant : 10 équipes → 2 poules de 5.
      const count = Math.max(1, Math.floor(teams.length / size));
      const groups = snake(order, count);
      const matches = groupMatches(groups);
      const qualifiers = crossings(groups.map((g) => g.group));
      if (qualifiers.length > MAX_BRACKET) {
        throw new Error(`Phase finale : ${MAX_BRACKET} équipes au plus.`);
      }
      const lastRound = Math.max(0, ...matches.map((m) => m.round));
      return {
        groups,
        matches: [
          ...matches,
          ...bracket(qualifiers, qualifiers.length >= 4, lastRound + 1),
        ],
      };
    }
  }
}

/** Libellé d'une place inconnue (« 1er poule A », « Vainqueur DF1 »). */
export function sourceLabel(source: Source): string {
  const [kind, a, b] = source.split(':');
  if (kind === 'group') {
    return `${b === '1' ? '1er' : `${b}e`} poule ${a}`;
  }
  return `${kind === 'winner' ? 'Vainqueur' : 'Perdant'} ${a?.toUpperCase()}`;
}

type Seed = { team: string } | { source: Source };

function groupMatches(
  groups: readonly { group: string; teams: readonly string[] }[],
): PlannedMatch[] {
  const matches: PlannedMatch[] = [];
  for (const { group, teams } of groups) {
    const pairings = generateRoundRobin(teams);
    pairings.forEach((pairing, index) => {
      matches.push({
        code: `${group.toLowerCase()}${index + 1}`,
        phase: 'groups',
        group,
        round: pairing.round,
        homeTeam: pairing.home,
        awayTeam: pairing.away,
        homeSource: null,
        awaySource: null,
      });
    });
  }
  return matches;
}

/** Répartit en serpentin : A B C C B A A B C… (tailles égales à une près). */
function snake(order: readonly string[], count: number) {
  const groups = Array.from({ length: count }, (_, i) => ({
    group: String.fromCharCode(65 + i),
    teams: [] as string[],
  }));
  order.forEach((team, i) => {
    const lap = Math.floor(i / count);
    const index = lap % 2 === 0 ? i % count : count - 1 - (i % count);
    groups[index]!.teams.push(team);
  });
  return groups;
}

/**
 * Qualifiés (deux par poule) rangés comme des têtes de série, pour que deux
 * équipes d'une même poule ne se retrouvent qu'en finale : avec 2 ou 4
 * poules, croisements classiques (1er A – 2e B, 1er B – 2e A…) ; sinon
 * premiers de poule d'abord, puis deuxièmes en ordre inverse, les meilleurs
 * profitant des exemptions.
 */
function crossings(groups: readonly string[]): Seed[] {
  const count = groups.length;
  const first = (g: string): Seed => ({ source: `group:${g}:1` });
  const second = (g: string): Seed => ({ source: `group:${g}:2` });
  if (count === 1) {
    return [first(groups[0]!), second(groups[0]!)];
  }
  if ((count & (count - 1)) === 0) {
    const size = count * 2;
    const seeds: Seed[] = Array.from({ length: size });
    groups.forEach((g, i) => {
      seeds[i] = first(g);
      // L'adversaire de la tête de série s est la tête de série size + 1 − s.
      seeds[size - 1 - (i ^ 1)] = second(g);
    });
    return seeds;
  }
  return [...groups.map(first), ...[...groups].reverse().map(second)];
}

/** Code d'un match du tableau d'après son tour (« qf2 », « df1 », « f »). */
const PREFIX: Record<number, { phase: Phase; prefix: string }> = {
  2: { phase: 'final', prefix: 'f' },
  4: { phase: 'semi', prefix: 'df' },
  8: { phase: 'quarter', prefix: 'qf' },
  16: { phase: 'round_of_16', prefix: 'hf' },
  32: { phase: 'round_of_32', prefix: 'sf' },
};

/**
 * Tableau à élimination directe pour des têtes de série dans l'ordre :
 * placement classique (1 contre le dernier…), exemptions pour les
 * premières têtes de série quand le nombre n'est pas une puissance de deux,
 * petite finale en option.
 */
function bracket(
  seeds: readonly Seed[],
  thirdPlace: boolean,
  firstRound: number,
): PlannedMatch[] {
  let size = 2;
  while (size < seeds.length) {
    size *= 2;
  }
  // Places du tableau : ordre classique des têtes de série (1, 8, 4, 5, 2, 7, 3, 6 pour 8).
  let positions = [1];
  while (positions.length < size) {
    const n = positions.length * 2 + 1;
    positions = positions.flatMap((p) => [p, n - p]);
  }
  let entrants: (Seed | null)[] = positions.map((p) => seeds[p - 1] ?? null);
  const matches: PlannedMatch[] = [];
  let round = firstRound;
  while (entrants.length > 1) {
    const { phase, prefix } = PREFIX[entrants.length]!;
    const next: (Seed | null)[] = [];
    let number = 0;
    for (let i = 0; i < entrants.length; i += 2) {
      const home = entrants[i] ?? null;
      const away = entrants[i + 1] ?? null;
      if (!home || !away) {
        // Exemption : l'équipe passe directement au tour suivant.
        next.push(home ?? away);
        continue;
      }
      number += 1;
      const code = prefix === 'f' ? 'f' : `${prefix}${number}`;
      matches.push(planned(code, phase, round, home, away));
      next.push({ source: `winner:${code}` });
    }
    if (phase === 'semi' && thirdPlace && number === 2) {
      matches.push(
        planned(
          'pf',
          'third_place',
          round + 1,
          { source: 'loser:df1' },
          { source: 'loser:df2' },
        ),
      );
    }
    entrants = next;
    round += 1;
  }
  return matches;
}

function planned(
  code: string,
  phase: Phase,
  round: number,
  home: Seed,
  away: Seed,
): PlannedMatch {
  return {
    code,
    phase,
    group: null,
    round,
    homeTeam: 'team' in home ? home.team : null,
    awayTeam: 'team' in away ? away.team : null,
    homeSource: 'source' in home ? home.source : null,
    awaySource: 'source' in away ? away.source : null,
  };
}

/** Mélange de Fisher-Yates avec un générateur déterministe tiré de la graine. */
function shuffle<T>(items: T[], seed: string): T[] {
  let state = 2166136261;
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  }
  const random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
