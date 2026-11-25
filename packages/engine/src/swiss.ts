import { shuffle, type PlannedMatch } from './bracket.js';
import { SPORT_RULES, type RankingRules } from './rules.js';
import {
  computeSwissStandings,
  type GroupResult,
  type StandingTeam,
} from './standings.js';

/**
 * Nombre de rondes d'un système suisse : log2 du nombre d'équipes arrondi
 * au-dessus, plus une (assez pour qu'un seul vainqueur se dégage), sans
 * dépasser le nombre de rondes possibles sans revanche.
 */
export function swissRoundCount(teams: number): number {
  if (teams < 2) {
    return 0;
  }
  const possible = teams % 2 === 0 ? teams - 1 : teams;
  return Math.min(Math.ceil(Math.log2(teams)) + 1, possible);
}

export interface SwissInput {
  /** Équipes du tournoi (code et nom, le nom départage en dernier). */
  teams: readonly StandingTeam[];
  /** Matchs des rondes précédentes ; seuls les terminés comptent. */
  results: readonly GroupResult[];
  /** Une entrée par exemption déjà accordée (code de l'équipe). */
  byes: readonly string[];
  /** Ronde à apparier, à partir de 1. */
  round: number;
  /** Graine du tirage de la première ronde. */
  seed: string;
  rules?: RankingRules;
}

export interface SwissRound {
  round: number;
  matches: PlannedMatch[];
  /** Équipe exempte de la ronde (nombre impair d'équipes), sinon null. */
  bye: string | null;
}

/** Au-delà, la recherche sans revanche s'arrête et accepte une revanche. */
const MAX_STEPS = 50_000;

/**
 * Appariement d'une ronde de système suisse. Première ronde : ordre tiré au
 * sort par la graine. Ensuite, les équipes sont rangées par le classement
 * (points, Buchholz, départages) et chacune affronte la mieux classée des
 * équipes encore libres qu'elle n'a pas déjà rencontrée ; un retour en
 * arrière évite de bloquer les dernières. Avec un nombre impair d'équipes,
 * la moins bien classée qui n'a pas encore été exempte l'est (victoire sans
 * but). Une revanche n'est acceptée que si aucun appariement n'y échappe.
 * L'équipe qui a le moins reçu joue à domicile. Fonction pure et
 * déterministe.
 */
export function pairSwissRound(input: SwissInput): SwissRound {
  const codes = [...new Set(input.teams.map((t) => t.id))];
  if (codes.length < 2) {
    throw new Error('Il faut au moins deux équipes.');
  }
  const rules = input.rules ?? SPORT_RULES.football;
  const finished = input.results.filter(
    (r): r is GroupResult & { homeTeamId: string; awayTeamId: string } =>
      r.finished && !!r.homeTeamId && !!r.awayTeamId,
  );
  const order =
    input.round <= 1 && finished.length === 0
      ? shuffle([...codes].sort(), input.seed)
      : computeSwissStandings(input.teams, finished, input.byes, rules).map(
          (row) => row.teamId,
        );

  const met = new Set(
    finished.flatMap((r) => [
      `${r.homeTeamId}|${r.awayTeamId}`,
      `${r.awayTeamId}|${r.homeTeamId}`,
    ]),
  );
  const homeGames = new Map<string, number>();
  for (const r of finished) {
    homeGames.set(r.homeTeamId, (homeGames.get(r.homeTeamId) ?? 0) + 1);
  }
  const byeCount = new Map<string, number>();
  for (const team of input.byes) {
    byeCount.set(team, (byeCount.get(team) ?? 0) + 1);
  }

  // Candidats à l'exemption : du bas du classement vers le haut, ceux qui
  // l'ont été le moins d'abord.
  const byeCandidates: (string | null)[] =
    order.length % 2 === 0
      ? [null]
      : [...order]
          .reverse()
          .sort((a, b) => (byeCount.get(a) ?? 0) - (byeCount.get(b) ?? 0));

  let pairs: [string, string][] | null = null;
  let bye: string | null = null;
  for (const allowRematch of [false, true]) {
    for (const candidate of byeCandidates) {
      const rest = order.filter((team) => team !== candidate);
      pairs = pairUp(rest, met, allowRematch);
      if (pairs) {
        bye = candidate;
        break;
      }
    }
    if (pairs) {
      break;
    }
  }

  const matches: PlannedMatch[] = pairs!.map(([high, low], index) => {
    const highHome = (homeGames.get(high) ?? 0) <= (homeGames.get(low) ?? 0);
    return {
      code: `r${input.round}-${index + 1}`,
      phase: 'swiss',
      group: null,
      round: input.round,
      homeTeam: highHome ? high : low,
      awayTeam: highHome ? low : high,
      homeSource: null,
      awaySource: null,
    };
  });
  return { round: input.round, matches, bye };
}

/** Appariement de proche en proche avec retour en arrière. */
function pairUp(
  order: readonly string[],
  met: ReadonlySet<string>,
  allowRematch: boolean,
): [string, string][] | null {
  let steps = 0;
  const search = (remaining: readonly string[]): [string, string][] | null => {
    if (remaining.length === 0) {
      return [];
    }
    if (++steps > MAX_STEPS) {
      return null;
    }
    const [first, ...others] = remaining;
    for (let i = 0; i < others.length; i += 1) {
      const opponent = others[i]!;
      if (!allowRematch && met.has(`${first}|${opponent}`)) {
        continue;
      }
      const rest = search([...others.slice(0, i), ...others.slice(i + 1)]);
      if (rest) {
        return [[first!, opponent], ...rest];
      }
    }
    return null;
  };
  return search(order);
}
