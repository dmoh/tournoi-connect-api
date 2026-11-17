import { describe, expect, it } from 'vitest';
import { advanceBracket, type MatchState } from './advance.js';
import { drawTournament, sourceLabel, type PlannedMatch } from './bracket.js';
import { scheduleMatches } from './schedule.js';
import { computeStandings } from './standings.js';

const teams = (n: number) =>
  Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
const pair = (m: PlannedMatch) => [
  m.code,
  m.homeSource ?? m.homeTeam,
  m.awaySource ?? m.awayTeam,
];

describe('drawTournament', () => {
  it('donne le même tirage pour la même graine, un autre sinon', () => {
    const input = {
      format: 'groups-knockout' as const,
      teams: teams(16),
      seed: 'coupe-2026',
    };
    expect(drawTournament(input)).toEqual(
      drawTournament({ ...input, teams: [...input.teams].reverse() }),
    );
    expect(drawTournament({ ...input, seed: 'autre' }).groups).not.toEqual(
      drawTournament(input).groups,
    );
  });

  it('16 équipes : 4 poules de 4, 24 matchs de poule et 8 matchs finaux', () => {
    const draw = drawTournament({
      format: 'groups-knockout',
      teams: teams(16),
      seed: 's',
    });
    expect(draw.groups.map((g) => [g.group, g.teams.length])).toEqual([
      ['A', 4],
      ['B', 4],
      ['C', 4],
      ['D', 4],
    ]);
    expect(new Set(draw.groups.flatMap((g) => g.teams)).size).toBe(16);
    const finals = draw.matches.filter((m) => m.phase !== 'groups');
    expect(draw.matches).toHaveLength(32);
    // Quarts croisés : les deux équipes d'une poule ne se retrouvent qu'en finale.
    expect(finals.map(pair)).toEqual([
      ['qf1', 'group:A:1', 'group:B:2'],
      ['qf2', 'group:D:1', 'group:C:2'],
      ['qf3', 'group:B:1', 'group:A:2'],
      ['qf4', 'group:C:1', 'group:D:2'],
      ['df1', 'winner:qf1', 'winner:qf2'],
      ['df2', 'winner:qf3', 'winner:qf4'],
      ['pf', 'loser:df1', 'loser:df2'],
      ['f', 'winner:df1', 'winner:df2'],
    ]);
  });

  it('2 poules : demi-finales 1er A – 2e B et 1er B – 2e A, comme la démo', () => {
    const draw = drawTournament({
      format: 'groups-knockout',
      teams: teams(8),
      seed: 's',
    });
    expect(draw.matches.filter((m) => m.phase === 'semi').map(pair)).toEqual([
      ['df1', 'group:A:1', 'group:B:2'],
      ['df2', 'group:B:1', 'group:A:2'],
    ]);
    expect(sourceLabel('group:A:1')).toBe('1er poule A');
    expect(sourceLabel('group:B:2')).toBe('2e poule B');
    expect(sourceLabel('winner:df1')).toBe('Vainqueur DF1');
  });

  it('3 poules : les meilleurs premiers sont exemptés de quart', () => {
    const draw = drawTournament({
      format: 'groups-knockout',
      teams: teams(12),
      seed: 's',
    });
    const finals = draw.matches.filter((m) => m.phase !== 'groups');
    // 6 qualifiés : 2 quarts, 2 demies, petite finale et finale.
    expect(finals.map(pair)).toEqual([
      ['qf1', 'group:C:2', 'group:B:2'],
      ['qf2', 'group:C:1', 'group:A:2'],
      ['df1', 'group:A:1', 'winner:qf1'],
      ['df2', 'group:B:1', 'winner:qf2'],
      ['pf', 'loser:df1', 'loser:df2'],
      ['f', 'winner:df1', 'winner:df2'],
    ]);
  });

  it('élimination directe à 6 : 5 matchs, deux équipes exemptées du premier tour', () => {
    const draw = drawTournament({
      format: 'knockout',
      teams: teams(6),
      seed: 's',
    });
    expect(draw.matches).toHaveLength(5);
    const semis = draw.matches.filter((m) => m.phase === 'semi');
    expect(semis.every((m) => m.homeTeam && !m.homeSource)).toBe(true);
  });

  it('poule unique : tout le monde se rencontre une fois', () => {
    const draw = drawTournament({
      format: 'single-group',
      teams: teams(5),
      seed: 's',
    });
    expect(draw.matches).toHaveLength(10);
    expect(draw.matches.every((m) => m.group === 'A')).toBe(true);
  });
});

/** Matchs regroupés par heure de début. */
const bySlot = <T extends { startsAt: number }>(matches: readonly T[]) => {
  const slots = new Map<number, T[]>();
  for (const match of matches) {
    slots.set(match.startsAt, [...(slots.get(match.startsAt) ?? []), match]);
  }
  return slots;
};

describe('scheduleMatches', () => {
  const draw = drawTournament({
    format: 'groups-knockout',
    teams: teams(8),
    seed: 's',
  });
  const start = Date.parse('2026-12-05T08:00:00Z');
  const scheduled = scheduleMatches(draw.matches, {
    startsAt: start,
    fields: 3,
    matchMinutes: 15,
    breakMinutes: 5,
  });

  it('n’occupe jamais plus de terrains qu’il n’y en a', () => {
    for (const slot of bySlot(scheduled).values()) {
      expect(slot.length).toBeLessThanOrEqual(3);
      expect(new Set(slot.map((m) => m.field)).size).toBe(slot.length);
    }
  });

  it('ne fait jamais jouer une équipe deux fois dans le même créneau', () => {
    for (const slot of bySlot(scheduled).values()) {
      const playing = slot
        .flatMap((m) => [m.homeTeam, m.awayTeam])
        .filter(Boolean);
      expect(new Set(playing).size).toBe(playing.length);
    }
  });

  it('joue le tableau après les poules, la finale après les demies', () => {
    const at = (code: string) =>
      scheduled.find((m) => m.code === code)!.startsAt;
    const lastGroup = Math.max(
      ...scheduled.filter((m) => m.group).map((m) => m.startsAt),
    );
    expect(at('df1')).toBeGreaterThan(lastGroup);
    expect(at('f')).toBeGreaterThan(at('df2'));
    expect(scheduled[0]!.startsAt).toBe(start);
    // Créneaux de 20 minutes (15 de jeu, 5 de battement).
    expect((at('df1') - start) % (20 * 60_000)).toBe(0);
  });
});

describe('advanceBracket', () => {
  const draw = drawTournament({
    format: 'groups-knockout',
    teams: teams(8),
    seed: 's',
  });
  const state = (
    overrides: Record<string, Partial<MatchState>> = {},
  ): MatchState[] =>
    draw.matches.map((m) => ({
      code: m.code,
      group: m.group,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeSource: m.homeSource,
      awaySource: m.awaySource,
      scoreHome: 0,
      scoreAway: 0,
      finished: false,
      winnerSide: null,
      started: false,
      ...overrides[m.code],
    }));
  const standingsOf = (matches: MatchState[]) =>
    computeStandings(
      draw.groups.flatMap((g) =>
        g.teams.map((id) => ({ id, name: id, group: g.group })),
      ),
      matches
        .filter((m) => m.group)
        .map((m) => ({
          homeTeamId: m.homeTeam,
          awayTeamId: m.awayTeam,
          scoreHome: m.scoreHome,
          scoreAway: m.scoreAway,
          finished: m.finished,
        })),
    );
  /** Poule A terminée : le premier du tirage gagne tous ses matchs. */
  const groupA = () =>
    Object.fromEntries(
      draw.matches
        .filter((m) => m.group === 'A')
        .map((m) => {
          const leader = draw.groups[0]!.teams[0];
          const home =
            m.homeTeam === leader ? 2 : m.awayTeam === leader ? 0 : 1;
          return [
            m.code,
            {
              finished: true,
              scoreHome: home,
              scoreAway: home === 2 ? 0 : home === 0 ? 2 : 1,
            },
          ];
        }),
    );

  it('attend la fin de toute la poule pour qualifier', () => {
    const partial = state({
      a1: { finished: true, scoreHome: 1, scoreAway: 0 },
    });
    expect(advanceBracket(partial, standingsOf(partial))).toEqual([]);
  });

  it('place le 1er et le 2e de la poule terminée', () => {
    const matches = state(groupA());
    const standings = standingsOf(matches);
    const [first, second] = standings[0]!.rows.map((r) => r.teamId);
    expect(first).toBe(draw.groups[0]!.teams[0]);
    expect(advanceBracket(matches, standings)).toEqual([
      { code: 'df1', homeTeam: first, awayTeam: null },
      { code: 'df2', homeTeam: null, awayTeam: second },
    ]);
  });

  it('qualifie le vainqueur aux tirs au but et le perdant pour la petite finale', () => {
    const matches = state({
      df1: {
        homeTeam: 'x',
        awayTeam: 'y',
        finished: true,
        scoreHome: 1,
        scoreAway: 1,
        winnerSide: 'away',
        started: true,
      },
      df2: {
        homeTeam: 'z',
        awayTeam: 'w',
        finished: true,
        scoreHome: 3,
        scoreAway: 0,
        started: true,
      },
    });
    expect(advanceBracket(matches, standingsOf(matches))).toEqual([
      { code: 'pf', homeTeam: 'x', awayTeam: 'w' },
      { code: 'f', homeTeam: 'y', awayTeam: 'z' },
    ]);
  });

  it('attend un vainqueur quand le score est nul, et ne touche pas un match commencé', () => {
    const tie = state({
      df1: {
        homeTeam: 'x',
        awayTeam: 'y',
        finished: true,
        scoreHome: 1,
        scoreAway: 1,
        started: true,
      },
      f: { homeTeam: 'old', started: true },
    });
    expect(advanceBracket(tie, standingsOf(tie))).toEqual([]);
  });

  it('vide une place dont le résultat a été annulé', () => {
    const matches = state({ f: { homeTeam: 'y', awayTeam: 'z' } });
    expect(advanceBracket(matches, standingsOf(matches))).toEqual([
      { code: 'f', homeTeam: null, awayTeam: null },
    ]);
  });
});
