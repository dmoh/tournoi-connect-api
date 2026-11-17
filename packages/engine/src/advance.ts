import type { Source } from './bracket.js';
import type { GroupStanding } from './standings.js';

/** État d'un match pour faire avancer le tableau. */
export interface MatchState {
  code: string;
  group: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeSource: Source | null;
  awaySource: Source | null;
  scoreHome: number;
  scoreAway: number;
  finished: boolean;
  /** Vainqueur aux tirs au but (ou désigné) quand le score est nul. */
  winnerSide: 'home' | 'away' | null;
  /** Un match commencé ne change plus d'équipes. */
  started: boolean;
}

export interface Assignment {
  code: string;
  homeTeam: string | null;
  awayTeam: string | null;
}

/**
 * Équipes connues de chaque match du tableau pas encore commencé : le
 * classement d'une poule une fois tous ses matchs terminés, le vainqueur ou
 * le perdant d'un match terminé. Une place qui n'est plus sûre (résultat
 * annulé) redevient vide. Ne renvoie que les matchs qui changent.
 */
export function advanceBracket(
  matches: readonly MatchState[],
  standings: readonly GroupStanding[],
): Assignment[] {
  const byCode = new Map(matches.map((m) => [m.code, m]));
  const complete = new Set(
    [
      ...new Set(matches.map((m) => m.group).filter((g): g is string => !!g)),
    ].filter((group) =>
      matches.filter((m) => m.group === group).every((m) => m.finished),
    ),
  );
  const ranking = new Map(
    standings.map((s) => [s.group, s.rows.map((r) => r.teamId)]),
  );

  const resolve = (
    source: Source | null,
    current: string | null,
  ): string | null => {
    if (!source) {
      return current;
    }
    const [kind, ref, rank] = source.split(':');
    if (kind === 'group') {
      return complete.has(ref!)
        ? (ranking.get(ref!)?.[Number(rank) - 1] ?? null)
        : null;
    }
    const match = byCode.get(ref!);
    if (!match?.finished || !match.homeTeam || !match.awayTeam) {
      return null;
    }
    const homeWins =
      match.scoreHome > match.scoreAway ||
      (match.scoreHome === match.scoreAway && match.winnerSide === 'home');
    const awayWins =
      match.scoreAway > match.scoreHome ||
      (match.scoreHome === match.scoreAway && match.winnerSide === 'away');
    if (!homeWins && !awayWins) {
      return null;
    }
    const winner = homeWins ? match.homeTeam : match.awayTeam;
    const loser = homeWins ? match.awayTeam : match.homeTeam;
    return kind === 'winner' ? winner : loser;
  };

  const changes: Assignment[] = [];
  for (const match of matches) {
    if (match.started || (!match.homeSource && !match.awaySource)) {
      continue;
    }
    const homeTeam = resolve(match.homeSource, match.homeTeam);
    const awayTeam = resolve(match.awaySource, match.awayTeam);
    if (homeTeam !== match.homeTeam || awayTeam !== match.awayTeam) {
      changes.push({ code: match.code, homeTeam, awayTeam });
    }
  }
  return changes;
}
