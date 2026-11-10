import { describe, expect, it } from 'vitest';
import {
  computeStandings,
  type GroupResult,
  type StandingTeam,
} from './standings.js';

const teams: StandingTeam[] = [
  { id: 'a', name: 'Alpha', group: 'A' },
  { id: 'b', name: 'Bravo', group: 'A' },
  { id: 'c', name: 'Charlie', group: 'A' },
  { id: 'd', name: 'Delta', group: 'B' },
];

const result = (
  home: string,
  away: string,
  h: number,
  a: number,
  finished = true,
): GroupResult => ({
  homeTeamId: home,
  awayTeamId: away,
  scoreHome: h,
  scoreAway: a,
  finished,
});

describe('computeStandings', () => {
  it('classe par points, puis différence de buts, puis buts marqués', () => {
    const [groupA] = computeStandings(teams, [
      result('a', 'b', 2, 0),
      result('b', 'c', 3, 1),
      result('c', 'a', 1, 0),
    ]);
    // Trois équipes à 3 points : Alpha +1 (2-1), Bravo 0 (3-3), Charlie -1 (2-3).
    expect(groupA?.rows.map((row) => [row.teamId, row.points])).toEqual([
      ['a', 3],
      ['b', 3],
      ['c', 3],
    ]);
  });

  it('ignore les matchs non terminés', () => {
    const [groupA] = computeStandings(teams, [result('a', 'b', 5, 0, false)]);
    expect(groupA?.rows.every((row) => row.played === 0)).toBe(true);
  });

  it('distribue autant de points que les résultats en donnent', () => {
    const results = [result('a', 'b', 1, 1), result('b', 'c', 2, 0)];
    const total = computeStandings(teams, results)
      .flatMap((group) => group.rows)
      .reduce((sum, row) => sum + row.points, 0);
    expect(total).toBe(2 + 3);
  });

  it('est déterministe : mêmes entrées, même sortie', () => {
    const results = [result('a', 'b', 1, 1), result('c', 'a', 0, 2)];
    expect(computeStandings(teams, results)).toEqual(
      computeStandings(teams, results),
    );
  });
});
