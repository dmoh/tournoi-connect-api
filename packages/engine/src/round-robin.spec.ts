import { describe, expect, it } from 'vitest';
import { generateRoundRobin } from './round-robin.js';

const key = (a: string, b: string) => [a, b].sort().join('-');

describe('generateRoundRobin', () => {
  it('fait se rencontrer chaque paire exactement une fois', () => {
    for (const n of [2, 3, 4, 5, 8, 11, 16]) {
      const teams = Array.from({ length: n }, (_, i) => `E${i + 1}`);
      const pairings = generateRoundRobin(teams);
      const seen = new Set(pairings.map((p) => key(p.home, p.away)));
      expect(pairings).toHaveLength((n * (n - 1)) / 2);
      expect(seen.size).toBe(pairings.length);
    }
  });

  it('ne fait jouer une équipe qu’une fois par journée', () => {
    const pairings = generateRoundRobin(['A', 'B', 'C', 'D', 'E']);
    const rounds = new Map<number, string[]>();
    for (const p of pairings) {
      rounds.set(p.round, [...(rounds.get(p.round) ?? []), p.home, p.away]);
    }
    expect(rounds.size).toBe(5);
    for (const players of rounds.values()) {
      expect(new Set(players).size).toBe(players.length);
    }
  });

  it('est déterministe', () => {
    const teams = ['A', 'B', 'C', 'D'];
    expect(generateRoundRobin(teams)).toEqual(generateRoundRobin(teams));
  });

  it('gère les cas limites', () => {
    expect(generateRoundRobin([])).toEqual([]);
    expect(generateRoundRobin(['A'])).toEqual([]);
    expect(() => generateRoundRobin(['A', 'A'])).toThrow();
  });
});
