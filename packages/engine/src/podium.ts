import type { Phase } from './bracket.js';

/** Match terminé ou non, tel que le podium le lit. */
export interface PodiumMatch {
  code: string;
  phase: Phase;
  homeTeam: string | null;
  awayTeam: string | null;
  scoreHome: number;
  scoreAway: number;
  finished: boolean;
  /** Vainqueur d'un nul à élimination (tirs au but). */
  winnerSide: 'home' | 'away' | null;
  /** Numéro de ronde d'un match de système suisse. */
  round?: number | null;
}

export interface PodiumInput {
  format: 'single-group' | 'groups-knockout' | 'knockout' | 'swiss';
  matches: readonly PodiumMatch[];
  /**
   * Classement final, du premier au dernier : la poule unique ou le
   * classement suisse (inutile pour un tableau final).
   */
  ranking?: readonly string[];
  /** Système suisse : rondes prévues. */
  swissRounds?: number | null;
}

export interface Podium {
  first: string;
  second: string | null;
  /** Troisième (petite finale) ; les deux demi-finalistes battus sans petite finale. */
  third: string[];
}

/**
 * Podium d'un tournoi terminé, ou null tant qu'il reste à jouer :
 * - tableau final : vainqueur et finaliste de la finale, vainqueur de la
 *   petite finale (ou les deux perdants des demies, ex aequo, sans petite
 *   finale) ; la finale et la petite finale doivent être terminées ;
 * - poule unique et système suisse : les trois premiers du classement, une
 *   fois tous les matchs (et toutes les rondes) joués.
 * Fonction pure et déterministe.
 */
export function podium(input: PodiumInput): Podium | null {
  if (input.format === 'single-group' || input.format === 'swiss') {
    const played = input.matches.filter((m) =>
      input.format === 'swiss' ? m.phase === 'swiss' : m.phase === 'groups',
    );
    const rounds = new Set(played.map((m) => m.round ?? 0));
    const allRounds =
      input.format !== 'swiss' ||
      (!!input.swissRounds && rounds.size >= input.swissRounds);
    const ranking = input.ranking ?? [];
    if (
      played.length === 0 ||
      !played.every((m) => m.finished) ||
      !allRounds ||
      !ranking[0]
    ) {
      return null;
    }
    return {
      first: ranking[0],
      second: ranking[1] ?? null,
      third: ranking[2] ? [ranking[2]] : [],
    };
  }
  const final = input.matches.find((m) => m.phase === 'final');
  const finalResult = final ? outcome(final) : null;
  if (!finalResult) {
    return null;
  }
  const small = input.matches.find((m) => m.phase === 'third_place');
  let third: string[];
  if (small) {
    const smallResult = outcome(small);
    if (!smallResult) {
      return null;
    }
    third = [smallResult.winner];
  } else {
    third = input.matches
      .filter((m) => m.phase === 'semi')
      .map(outcome)
      .flatMap((r) => (r ? [r.loser] : []));
  }
  return { first: finalResult.winner, second: finalResult.loser, third };
}

/** Vainqueur et perdant d'un match à élimination terminé, sinon null. */
function outcome(m: PodiumMatch): { winner: string; loser: string } | null {
  if (!m.finished || !m.homeTeam || !m.awayTeam) {
    return null;
  }
  const side =
    m.scoreHome > m.scoreAway
      ? 'home'
      : m.scoreAway > m.scoreHome
        ? 'away'
        : m.winnerSide;
  if (!side) {
    return null;
  }
  return side === 'home'
    ? { winner: m.homeTeam, loser: m.awayTeam }
    : { winner: m.awayTeam, loser: m.homeTeam };
}

/** But marqué, tel que la table de marque l'a saisi (non annulé). */
export interface Goal {
  team: string;
  player: string | null;
}

export interface Scorer {
  team: string;
  player: string;
  goals: number;
}

/**
 * Meilleurs buteurs : buts groupés par équipe et nom de joueur (casse et
 * espaces ignorés), du plus grand nombre au plus petit, puis par nom. Les
 * buts sans buteur ne comptent pas.
 */
export function topScorers(goals: readonly Goal[], limit = 10): Scorer[] {
  const tally = new Map<string, Scorer>();
  for (const goal of goals) {
    const name = goal.player?.trim().replace(/\s+/g, ' ');
    if (!name) {
      continue;
    }
    const key = `${goal.team}|${name.toLocaleLowerCase('fr')}`;
    const entry = tally.get(key) ?? { team: goal.team, player: name, goals: 0 };
    entry.goals += 1;
    tally.set(key, entry);
  }
  return [...tally.values()]
    .sort(
      (a, b) =>
        b.goals - a.goals ||
        a.player.localeCompare(b.player, 'fr') ||
        a.team.localeCompare(b.team),
    )
    .slice(0, limit);
}
