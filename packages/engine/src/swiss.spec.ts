import { describe, expect, it } from 'vitest';
import { SPORT_RULES } from './rules.js';
import { computeSwissStandings, type GroupResult } from './standings.js';
import { pairSwissRound, swissRoundCount } from './swiss.js';

const teamsOf = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `e${i + 1}`,
    name: `Équipe ${String(i + 1).padStart(2, '0')}`,
  }));

/** L'équipe au plus petit numéro gagne toujours 2-0. */
function play(home: string, away: string): GroupResult {
  const homeWins = Number(home.slice(1)) < Number(away.slice(1));
  return {
    homeTeamId: home,
    awayTeamId: away,
    scoreHome: homeWins ? 2 : 0,
    scoreAway: homeWins ? 0 : 2,
    finished: true,
  };
}

/** Joue toutes les rondes et renvoie résultats et exemptions. */
function simulate(count: number, seed = 'graine') {
  const teams = teamsOf(count);
  const results: GroupResult[] = [];
  const byes: string[] = [];
  const rounds = swissRoundCount(count);
  for (let round = 1; round <= rounds; round += 1) {
    const paired = pairSwissRound({ teams, results, byes, round, seed });
    for (const m of paired.matches) {
      results.push(play(m.homeTeam!, m.awayTeam!));
    }
    if (paired.bye) {
      byes.push(paired.bye);
    }
  }
  return { teams, results, byes, rounds };
}

const key = (r: GroupResult) => [r.homeTeamId, r.awayTeamId].sort().join('|');

describe('swissRoundCount', () => {
  it('donne log2 + 1 rondes, sans dépasser les rondes sans revanche', () => {
    expect(swissRoundCount(1)).toBe(0);
    expect(swissRoundCount(2)).toBe(1);
    expect(swissRoundCount(3)).toBe(3);
    expect(swissRoundCount(4)).toBe(3);
    expect(swissRoundCount(8)).toBe(4);
    expect(swissRoundCount(10)).toBe(5);
    expect(swissRoundCount(16)).toBe(5);
  });
});

describe('pairSwissRound', () => {
  it('tire la première ronde au sort, de façon reproductible', () => {
    const teams = teamsOf(8);
    const first = pairSwissRound({
      teams,
      results: [],
      byes: [],
      round: 1,
      seed: 'a1',
    });
    const again = pairSwissRound({
      teams,
      results: [],
      byes: [],
      round: 1,
      seed: 'a1',
    });
    const other = pairSwissRound({
      teams,
      results: [],
      byes: [],
      round: 1,
      seed: 'b2',
    });
    expect(again).toEqual(first);
    expect(other.matches).not.toEqual(first.matches);
    expect(first.matches).toHaveLength(4);
    expect(first.matches[0]).toMatchObject({
      code: 'r1-1',
      phase: 'swiss',
      group: null,
      round: 1,
    });
    expect(first.bye).toBeNull();
  });

  it('fait jouer chaque équipe une fois par ronde, sans revanche', () => {
    const { results, rounds } = simulate(8);
    expect(rounds).toBe(4);
    expect(results).toHaveLength(16);
    expect(new Set(results.map(key)).size).toBe(16);
    for (let round = 0; round < rounds; round += 1) {
      const slice = results.slice(round * 4, round * 4 + 4);
      const teams = slice.flatMap((r) => [r.homeTeamId, r.awayTeamId]);
      expect(new Set(teams).size).toBe(8);
    }
  });

  it('apparie les équipes de même bilan et fait ressortir un seul invaincu', () => {
    const { teams, results, byes } = simulate(8);
    const standings = computeSwissStandings(teams, results, byes);
    expect(standings[0]).toMatchObject({ teamId: 'e1', won: 4, points: 12 });
    expect(standings[1]!.won).toBe(3);
    // Deuxième ronde : les vainqueurs de la première s'affrontent.
    const firstRound = results.slice(0, 4);
    const winners = new Set(
      firstRound.map((r) =>
        r.scoreHome > r.scoreAway ? r.homeTeamId : r.awayTeamId,
      ),
    );
    for (const r of results.slice(4, 8)) {
      expect(winners.has(r.homeTeamId)).toBe(winners.has(r.awayTeamId));
    }
  });

  it('exempte une équipe différente à chaque ronde avec un nombre impair', () => {
    const { results, byes, rounds } = simulate(7);
    expect(rounds).toBe(4);
    expect(byes).toHaveLength(4);
    expect(new Set(byes).size).toBe(4);
    expect(new Set(results.map(key)).size).toBe(results.length);
    for (const team of byes) {
      expect(
        results
          .slice(byes.indexOf(team) * 3, byes.indexOf(team) * 3 + 3)
          .some((r) => r.homeTeamId === team || r.awayTeamId === team),
      ).toBe(false);
    }
  });

  it('accepte une revanche seulement quand aucun appariement n’y échappe', () => {
    const teams = teamsOf(2);
    const results = [play('e1', 'e2')];
    const second = pairSwissRound({
      teams,
      results,
      byes: [],
      round: 2,
      seed: 'x',
    });
    expect(second.matches).toHaveLength(1);
  });

  it('fait recevoir l’équipe qui a le moins joué à domicile', () => {
    const teams = teamsOf(4);
    const results = [play('e1', 'e2'), play('e3', 'e4')];
    const second = pairSwissRound({
      teams,
      results,
      byes: [],
      round: 2,
      seed: 'x',
    });
    // e1 et e3 (vainqueurs, déjà reçus) se rencontrent : égalité, le mieux
    // classé reçoit ; e2 et e4 n'ont jamais reçu.
    const losers = second.matches.find((m) =>
      [m.homeTeam, m.awayTeam].includes('e2'),
    )!;
    expect([losers.homeTeam, losers.awayTeam].sort()).toEqual(['e2', 'e4']);
    const winners = second.matches.find((m) =>
      [m.homeTeam, m.awayTeam].includes('e1'),
    )!;
    expect(winners.homeTeam).toBe('e1');
  });
});

describe('computeSwissStandings', () => {
  it('départage les égalités de points au Buchholz', () => {
    const teams = teamsOf(4);
    // e1 bat e2, e3 bat e4, puis e2 bat e4 et e3 bat e1.
    const results: GroupResult[] = [
      play('e1', 'e2'),
      play('e3', 'e4'),
      play('e2', 'e4'),
      {
        homeTeamId: 'e3',
        awayTeamId: 'e1',
        scoreHome: 1,
        scoreAway: 0,
        finished: true,
      },
    ];
    const rows = computeSwissStandings(teams, results, []);
    expect(rows.map((r) => r.teamId)).toEqual(['e3', 'e1', 'e2', 'e4']);
    // e1 (3 pts) a joué e2 (3) et e3 (6) ; e2 (3 pts) a joué e1 (3) et e4 (0).
    expect(rows.find((r) => r.teamId === 'e1')!.buchholz).toBe(9);
    expect(rows.find((r) => r.teamId === 'e2')!.buchholz).toBe(3);
  });

  it('compte une exemption comme une victoire sans but', () => {
    const rows = computeSwissStandings(
      teamsOf(3),
      [play('e2', 'e3')],
      ['e1'],
      SPORT_RULES.handball,
    );
    // À égalité de points et de Buchholz, la différence de buts classe e2.
    expect(rows.map((r) => r.teamId)).toEqual(['e2', 'e1', 'e3']);
    expect(rows[1]).toMatchObject({
      teamId: 'e1',
      played: 1,
      won: 1,
      byes: 1,
      points: 3,
      goalsFor: 0,
      buchholz: 0,
    });
  });
});
