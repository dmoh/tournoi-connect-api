import { describe, expect, it } from 'vitest';
import {
  rulesFor,
  SPORT_RULES,
  validateRules,
  type RankingRules,
} from './rules.js';
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

describe('règles par sport et départages', () => {
  const four: StandingTeam[] = [
    { id: 'a', name: 'Alpha', group: 'A' },
    { id: 'b', name: 'Bravo', group: 'A' },
    { id: 'c', name: 'Charlie', group: 'A' },
    { id: 'd', name: 'Delta', group: 'A' },
  ];
  const order = (rules?: RankingRules, results = cycle) =>
    computeStandings(four, results, rules)[0]!.rows.map((row) => row.teamId);

  // Alpha et Bravo à 6 points ; Bravo a battu Alpha, mais Alpha a la
  // meilleure différence (+8 contre +1). Delta 4 points, Charlie 1.
  const cycle = [
    result('b', 'a', 1, 0),
    result('a', 'c', 5, 0),
    result('a', 'd', 4, 0),
    result('b', 'c', 1, 0),
    result('d', 'b', 1, 0),
    result('c', 'd', 2, 2),
  ];

  it('la confrontation directe passe avant la différence de buts (football)', () => {
    expect(order(SPORT_RULES.football)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('l’organisateur peut mettre la différence générale en premier', () => {
    expect(
      order({
        ...SPORT_RULES.football,
        tiebreakers: ['difference', 'headToHead'],
      }),
    ).toEqual(['a', 'b', 'd', 'c']);
  });

  it('la confrontation directe ne compte que les équipes encore à égalité', () => {
    // Trois équipes à 3 points en cycle : la mini-ligue ne les sépare pas,
    // la différence générale si.
    const results = [
      result('a', 'b', 2, 0),
      result('b', 'c', 3, 1),
      result('c', 'a', 1, 0),
    ];
    expect(
      computeStandings(teams, results)[0]!.rows.map((r) => r.teamId),
    ).toEqual(['a', 'b', 'c']);
  });

  it('handball : 3 points la victoire, 2 le nul, 1 la défaite', () => {
    const [group] = computeStandings(
      four,
      [result('a', 'b', 25, 20), result('c', 'd', 18, 18)],
      SPORT_RULES.handball,
    );
    expect(
      Object.fromEntries(group!.rows.map((r) => [r.teamId, r.points])),
    ).toEqual({
      a: 3,
      b: 1,
      c: 2,
      d: 2,
    });
  });

  it('rugby : bonus défensif pour une défaite de 7 points ou moins', () => {
    const [group] = computeStandings(
      four,
      [result('a', 'b', 20, 14), result('c', 'd', 30, 10)],
      SPORT_RULES.rugby,
    );
    const rows = Object.fromEntries(group!.rows.map((r) => [r.teamId, r]));
    expect(rows['a']).toMatchObject({ points: 4, bonus: 0 });
    expect(rows['b']).toMatchObject({ points: 1, bonus: 1 });
    expect(rows['d']).toMatchObject({ points: 0, bonus: 0 });
  });

  it('volley : les victoires départagent avant les sets', () => {
    // Bravo (une victoire, une défaite) et Alpha (deux nuls) à 2 points,
    // même différence et mêmes sets gagnés : Bravo passe devant par ses victoires.
    const rules: RankingRules = {
      ...SPORT_RULES.volleyball,
      points: { win: 2, draw: 1, loss: 0 },
    };
    const [group] = computeStandings(
      four,
      [
        result('b', 'c', 2, 0),
        result('d', 'b', 2, 0),
        result('a', 'c', 1, 1),
        result('a', 'd', 1, 1),
      ],
      rules,
    );
    const top = group!.rows.filter((r) => r.teamId === 'a' || r.teamId === 'b');
    expect(top.map((r) => [r.teamId, r.points, r.won])).toEqual([
      ['b', 2, 1],
      ['a', 2, 0],
    ]);
  });

  it('ne dépend pas de l’ordre des résultats', () => {
    const shuffled = [...cycle].reverse();
    expect(order(SPORT_RULES.football, shuffled)).toEqual(
      order(SPORT_RULES.football),
    );
  });

  it('prend les règles du sport sauf réglage de l’organisateur', () => {
    expect(rulesFor('rugby').losingBonus).toEqual({ margin: 7, points: 1 });
    const custom = {
      ...SPORT_RULES.football,
      tiebreakers: ['scored'] as const,
    };
    expect(rulesFor('football', custom)).toBe(custom);
  });

  it('refuse des règles incohérentes', () => {
    expect(validateRules(SPORT_RULES.rugby)).toEqual([]);
    expect(
      validateRules({
        ...SPORT_RULES.football,
        points: { win: 1, draw: 1, loss: 0 },
      }),
    ).toHaveLength(1);
    expect(
      validateRules({
        ...SPORT_RULES.football,
        tiebreakers: ['scored', 'scored'],
      }),
    ).toHaveLength(1);
    expect(
      validateRules({
        ...SPORT_RULES.rugby,
        losingBonus: { margin: 7, points: 4 },
      }),
    ).toHaveLength(1);
  });
});
