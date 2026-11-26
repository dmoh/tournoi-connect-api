import { describe, expect, it } from 'vitest';
import { podium, topScorers, type PodiumMatch } from './podium.js';

const match = (
  code: string,
  phase: PodiumMatch['phase'],
  home: string,
  away: string,
  scoreHome: number,
  scoreAway: number,
  extra: Partial<PodiumMatch> = {},
): PodiumMatch => ({
  code,
  phase,
  homeTeam: home,
  awayTeam: away,
  scoreHome,
  scoreAway,
  finished: true,
  winnerSide: null,
  ...extra,
});

describe('podium', () => {
  const semis = [
    match('df1', 'semi', 'a', 'b', 2, 0),
    match('df2', 'semi', 'c', 'd', 1, 3),
  ];

  it('tableau final : finale, finaliste et vainqueur de la petite finale', () => {
    expect(
      podium({
        format: 'groups-knockout',
        matches: [
          ...semis,
          match('pf', 'third_place', 'b', 'c', 1, 1, { winnerSide: 'away' }),
          match('f', 'final', 'a', 'd', 0, 1),
        ],
      }),
    ).toEqual({ first: 'd', second: 'a', third: ['c'] });
  });

  it('attend la finale, la petite finale et un vainqueur aux tirs au but', () => {
    const unfinished = match('f', 'final', 'a', 'd', 0, 0, { finished: false });
    expect(
      podium({ format: 'knockout', matches: [...semis, unfinished] }),
    ).toBeNull();
    // Nul sans vainqueur désigné : pas encore de champion.
    expect(
      podium({
        format: 'knockout',
        matches: [...semis, match('f', 'final', 'a', 'd', 2, 2)],
      }),
    ).toBeNull();
    expect(
      podium({
        format: 'groups-knockout',
        matches: [
          ...semis,
          match('pf', 'third_place', 'b', 'c', 0, 0, { finished: false }),
          match('f', 'final', 'a', 'd', 2, 1),
        ],
      }),
    ).toBeNull();
  });

  it('sans petite finale, les deux demi-finalistes battus sont troisièmes ex aequo', () => {
    expect(
      podium({
        format: 'knockout',
        matches: [
          ...semis,
          match('f', 'final', 'a', 'd', 3, 3, { winnerSide: 'home' }),
        ],
      }),
    ).toEqual({ first: 'a', second: 'd', third: ['b', 'c'] });
  });

  it('poule unique et système suisse : les trois premiers une fois tout joué', () => {
    const group = [
      match('a1', 'groups', 'x', 'y', 1, 0),
      match('a2', 'groups', 'y', 'z', 1, 0),
    ];
    expect(
      podium({
        format: 'single-group',
        matches: group,
        ranking: ['x', 'y', 'z'],
      }),
    ).toEqual({ first: 'x', second: 'y', third: ['z'] });
    expect(
      podium({
        format: 'single-group',
        matches: [
          ...group,
          match('a3', 'groups', 'x', 'z', 0, 0, { finished: false }),
        ],
        ranking: ['x', 'y', 'z'],
      }),
    ).toBeNull();

    const r1 = match('r1-1', 'swiss', 'x', 'y', 1, 0, { round: 1 });
    const r2 = match('r2-1', 'swiss', 'x', 'z', 1, 0, { round: 2 });
    expect(
      podium({
        format: 'swiss',
        matches: [r1],
        ranking: ['x', 'y'],
        swissRounds: 2,
      }),
    ).toBeNull();
    expect(
      podium({
        format: 'swiss',
        matches: [r1, r2],
        ranking: ['x', 'z', 'y'],
        swissRounds: 2,
      }),
    ).toEqual({ first: 'x', second: 'z', third: ['y'] });
  });
});

describe('topScorers', () => {
  it('compte les buts par joueur et équipe, sans tenir compte de la casse', () => {
    expect(
      topScorers([
        { team: 'a', player: 'Léo Martin' },
        { team: 'a', player: ' léo  martin ' },
        { team: 'b', player: 'Inès' },
        { team: 'b', player: null },
        { team: 'b', player: 'Ana' },
        { team: 'a', player: 'Inès' },
      ]),
    ).toEqual([
      { team: 'a', player: 'Léo Martin', goals: 2 },
      { team: 'b', player: 'Ana', goals: 1 },
      { team: 'a', player: 'Inès', goals: 1 },
      { team: 'b', player: 'Inès', goals: 1 },
    ]);
  });
});
