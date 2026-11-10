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
  points: number;
}

export interface GroupStanding {
  group: string;
  rows: StandingRow[];
}

export interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

export const FOOTBALL_POINTS: PointsRule = { win: 3, draw: 1, loss: 0 };

/**
 * Classement de chaque poule : points, puis différence, puis buts marqués,
 * puis nom (ordre stable). Fonction pure et déterministe ; la confrontation
 * directe et les départages paramétrables viendront avec les règles par sport.
 */
export function computeStandings(
  teams: readonly StandingTeam[],
  results: readonly GroupResult[],
  points: PointsRule = FOOTBALL_POINTS,
): GroupStanding[] {
  const rows = new Map<string, StandingRow>();
  for (const team of teams) {
    if (team.group) {
      rows.set(team.id, emptyRow(team.id));
    }
  }

  for (const result of results) {
    if (!result.finished || !result.homeTeamId || !result.awayTeamId) {
      continue;
    }
    const home = rows.get(result.homeTeamId);
    const away = rows.get(result.awayTeamId);
    if (!home || !away) {
      continue;
    }
    record(home, result.scoreHome, result.scoreAway, points);
    record(away, result.scoreAway, result.scoreHome, points);
  }

  const names = new Map(teams.map((team) => [team.id, team.name]));
  const groups = [
    ...new Set(
      teams.map((team) => team.group).filter((g): g is string => Boolean(g)),
    ),
  ].sort();
  return groups.map((group) => ({
    group,
    rows: teams
      .filter((team) => team.group === group)
      .map((team) => rows.get(team.id))
      .filter((row): row is StandingRow => row !== undefined)
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
          b.goalsFor - a.goalsFor ||
          (names.get(a.teamId) ?? '').localeCompare(
            names.get(b.teamId) ?? '',
            'fr',
          ),
      ),
  }));
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
    points: 0,
  };
}

function record(
  row: StandingRow,
  scored: number,
  conceded: number,
  points: PointsRule,
): void {
  row.played += 1;
  row.goalsFor += scored;
  row.goalsAgainst += conceded;
  if (scored > conceded) {
    row.won += 1;
    row.points += points.win;
  } else if (scored === conceded) {
    row.drawn += 1;
    row.points += points.draw;
  } else {
    row.lost += 1;
    row.points += points.loss;
  }
}
