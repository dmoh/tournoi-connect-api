import {
  GOAL_PUSH_INTERVAL_MS,
  cleanText,
  goalNotified,
} from './reporter-input.js';

describe('goalNotified', () => {
  const t0 = new Date('2026-11-09T10:00:00Z').getTime();
  const at = (...seconds: number[]) =>
    seconds.map((s) => new Date(t0 + s * 1000));

  it('notifie le premier but du match', () => {
    expect(goalNotified(at(0))).toBe(true);
  });

  it('tait les buts suivants pendant 20 secondes après une notification', () => {
    expect(goalNotified(at(0, 5))).toBe(false);
    expect(goalNotified(at(0, 19.999))).toBe(false);
    expect(goalNotified(at(0, GOAL_PUSH_INTERVAL_MS / 1000))).toBe(true);
  });

  it('compte depuis le dernier but notifié, pas depuis le dernier but', () => {
    // 0 notifié, 10 et 18 tus, 21 notifié (21 s après 0), 30 tu, 41 notifié.
    expect(goalNotified(at(0, 10, 18))).toBe(false);
    expect(goalNotified(at(0, 10, 18, 21))).toBe(true);
    expect(goalNotified(at(0, 10, 18, 21, 30))).toBe(false);
    expect(goalNotified(at(0, 10, 18, 21, 30, 41))).toBe(true);
  });
});

describe('cleanText', () => {
  it('retire les contrôles et caractères invisibles, regroupe les espaces', () => {
    expect(cleanText('  T.  Roux\n\t ')).toBe('T. Roux');
    expect(cleanText('L. Mar​tin‮')).toBe('L. Martin');
    expect(cleanText('A\u0000B\u0007C')).toBe('A B C');
    expect(cleanText('Zélie')).toBe('Zélie');
  });

  it('ne garde rien d’un texte vide après nettoyage', () => {
    expect(cleanText('​ \u0000 ')).toBeUndefined();
    expect(cleanText(undefined)).toBeUndefined();
  });
});
