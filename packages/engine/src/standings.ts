import {
  SPORT_RULES,
  type PointsRule,
  type RankingRules,
  type Tiebreaker,
} from './rules.js';

/** Équipe d'un groupe, identifiée par un code stable dans le tournoi. */
export interface StandingTeam {
  id: string;
  name: string;
  group?: string | null;
}

/** Résultat d'un match de poule. */
export interface GroupResult {
  homeTeamId: string | null;
  awayTeamId: string | null;
  scoreHome: number;
  scoreAway: number;
  /** Seuls les matchs terminés comptent. */
  finished: boolean;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Bonus défensifs obtenus (rugby). */
  bonus: number;
  points: number;
}

export interface GroupStanding {
  group: string;
  rows: StandingRow[];
}

/** Points du football, gardés pour les appels existants. */
export const FOOTBALL_POINTS: PointsRule = SPORT_RULES.football.points;

interface Played {
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
}

/**
 * Classement de chaque poule selon les règles du tournoi : points (avec le
 * bonus défensif éventuel), puis chaque critère de départage dans l'ordre
 * choisi, puis le nom (ordre stable). La confrontation directe ne compte
 * que les matchs entre les équipes encore à égalité. Fonction pure et
 * déterministe.
 */
export function computeStandings(
  teams: readonly StandingTeam[],
  results: readonly GroupResult[],
  rules: RankingRules = SPORT_RULES.football,
): GroupStanding[] {
  const rows = new Map<string, StandingRow>();
  for (const team of teams) {
    if (team.group) {
      rows.set(team.id, emptyRow(team.id));
    }
  }

  const played: Played[] = [];
  for (const result of results) {
    if (!result.finished || !result.homeTeamId || !result.awayTeamId) {
      continue;
    }
    const home = rows.get(result.homeTeamId);
    const away = rows.get(result.awayTeamId);
    if (!home || !away) {
      continue;
    }
    record(home, result.scoreHome, result.scoreAway, rules);
    record(away, result.scoreAway, result.scoreHome, rules);
    played.push({
      home: result.homeTeamId,
      away: result.awayTeamId,
      scoreHome: result.scoreHome,
      scoreAway: result.scoreAway,
    });
  }

  const names = new Map(teams.map((team) => [team.id, team.name]));
  const byName = (a: StandingRow, b: StandingRow) =>
    (names.get(a.teamId) ?? '').localeCompare(names.get(b.teamId) ?? '', 'fr');
  const groups = [
    ...new Set(
      teams.map((team) => team.group).filter((g): g is string => Boolean(g)),
    ),
  ].sort();
  return groups.map((group) => {
    const groupRows = teams
      .filter((team) => team.group === group)
      .map((team) => rows.get(team.id))
      .filter((row): row is StandingRow => row !== undefined);
    return {
      group,
      rows: rank(
        groupRows,
        ['points', ...rules.tiebreakers],
        played,
        rules,
        byName,
      ),
    };
  });
}

/** Ligne du classement d'un système suisse. */
export interface SwissStandingRow extends StandingRow {
  /** Buchholz : total des points des adversaires rencontrés. */
  buchholz: number;
  /** Rondes passées exempt (comptées comme une victoire sans but). */
  byes: number;
}

/**
 * Classement général d'un système suisse : points (une exemption vaut une
 * victoire sans but), puis Buchholz (total des points des adversaires
 * rencontrés, qui récompense un parcours plus difficile), puis les critères
 * de départage du tournoi, puis le nom. Fonction pure et déterministe.
 */
export function computeSwissStandings(
  teams: readonly StandingTeam[],
  results: readonly GroupResult[],
  byes: readonly string[],
  rules: RankingRules = SPORT_RULES.football,
): SwissStandingRow[] {
  const rows = new Map<string, SwissStandingRow>();
  for (const team of teams) {
    rows.set(team.id, { ...emptyRow(team.id), buchholz: 0, byes: 0 });
  }
  const played: Played[] = [];
  for (const result of results) {
    if (!result.finished || !result.homeTeamId || !result.awayTeamId) {
      continue;
    }
    const home = rows.get(result.homeTeamId);
    const away = rows.get(result.awayTeamId);
    if (!home || !away) {
      continue;
    }
    record(home, result.scoreHome, result.scoreAway, rules);
    record(away, result.scoreAway, result.scoreHome, rules);
    played.push({
      home: result.homeTeamId,
      away: result.awayTeamId,
      scoreHome: result.scoreHome,
      scoreAway: result.scoreAway,
    });
  }
  for (const team of byes) {
    const row = rows.get(team);
    if (row) {
      row.played += 1;
      row.won += 1;
      row.byes += 1;
      row.points += rules.points.win;
    }
  }
  for (const match of played) {
    rows.get(match.home)!.buchholz += rows.get(match.away)!.points;
    rows.get(match.away)!.buchholz += rows.get(match.home)!.points;
  }
  const names = new Map(teams.map((team) => [team.id, team.name]));
  const byName = (a: StandingRow, b: StandingRow) =>
    (names.get(a.teamId) ?? '').localeCompare(names.get(b.teamId) ?? '', 'fr');
  return rank(
    [...rows.values()],
    ['points', 'buchholz', ...rules.tiebreakers],
    played,
    rules,
    byName,
  ) as SwissStandingRow[];
}

type Criterion = 'points' | 'buchholz' | Tiebreaker;

/**
 * Classe des équipes critère par critère : les équipes que le premier
 * critère ne sépare pas sont départagées par les suivants.
 */
function rank(
  rows: StandingRow[],
  criteria: readonly Criterion[],
  played: readonly Played[],
  rules: RankingRules,
  byName: (a: StandingRow, b: StandingRow) => number,
): StandingRow[] {
  if (rows.length <= 1) {
    return rows;
  }
  const [criterion, ...rest] = criteria;
  if (!criterion) {
    return [...rows].sort(byName);
  }
  const keys = new Map(
    rows.map((row) => [row.teamId, keyOf(criterion, row, rows, played, rules)]),
  );
  const sorted = [...rows].sort((a, b) =>
    compareKeys(keys.get(b.teamId)!, keys.get(a.teamId)!),
  );
  const ranked: StandingRow[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (
      j < sorted.length &&
      compareKeys(
        keys.get(sorted[i]!.teamId)!,
        keys.get(sorted[j]!.teamId)!,
      ) === 0
    ) {
      j += 1;
    }
    ranked.push(...rank(sorted.slice(i, j), rest, played, rules, byName));
    i = j;
  }
  return ranked;
}

/** Valeur d'un critère pour une équipe, la plus grande étant la meilleure. */
function keyOf(
  criterion: Criterion,
  row: StandingRow,
  tied: readonly StandingRow[],
  played: readonly Played[],
  rules: RankingRules,
): number[] {
  switch (criterion) {
    case 'points':
      return [row.points];
    case 'buchholz':
      return [(row as Partial<SwissStandingRow>).buchholz ?? 0];
    case 'difference':
      return [row.goalsFor - row.goalsAgainst];
    case 'scored':
      return [row.goalsFor];
    case 'wins':
      return [row.won];
    case 'conceded':
      return [-row.goalsAgainst];
    case 'headToHead': {
      const ids = new Set(tied.map((r) => r.teamId));
      const mini = emptyRow(row.teamId);
      for (const match of played) {
        if (!ids.has(match.home) || !ids.has(match.away)) {
          continue;
        }
        if (match.home === row.teamId) {
          record(mini, match.scoreHome, match.scoreAway, rules);
        } else if (match.away === row.teamId) {
          record(mini, match.scoreAway, match.scoreHome, rules);
        }
      }
      return [mini.points, mini.goalsFor - mini.goalsAgainst, mini.goalsFor];
    }
  }
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function emptyRow(teamId: string): StandingRow {
  return {
    teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    bonus: 0,
    points: 0,
  };
}

function record(
  row: StandingRow,
  scored: number,
  conceded: number,
  rules: RankingRules,
): void {
  row.played += 1;
  row.goalsFor += scored;
  row.goalsAgainst += conceded;
  if (scored > conceded) {
    row.won += 1;
    row.points += rules.points.win;
  } else if (scored === conceded) {
    row.drawn += 1;
    row.points += rules.points.draw;
  } else {
    row.lost += 1;
    row.points += rules.points.loss;
    if (rules.losingBonus && conceded - scored <= rules.losingBonus.margin) {
      row.bonus += 1;
      row.points += rules.losingBonus.points;
    }
  }
}
