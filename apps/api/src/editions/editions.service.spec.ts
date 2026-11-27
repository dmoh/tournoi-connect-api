import {
  addDays,
  nextEditionDate,
  parisDate,
  parisTime,
} from '../common/paris-time.js';
import { nextEditionName } from './editions.service.js';

describe('édition suivante', () => {
  it('avance l’année du nom, laisse un nom sans année', () => {
    expect(nextEditionName('Tournoi de la Toussaint 2026')).toBe(
      'Tournoi de la Toussaint 2027',
    );
    expect(nextEditionName('Saison 2026-2027')).toBe('Saison 2027-2028');
    expect(nextEditionName('Challenge U13 de l’Arve')).toBe(
      'Challenge U13 de l’Arve',
    );
    expect(nextEditionName('Coupe des 1000 buts')).toBe('Coupe des 1000 buts');
  });

  it('garde le jour de la semaine, même par-dessus le 29 février', () => {
    const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
    for (const date of ['2026-11-09', '2027-03-01', '2027-12-31']) {
      const next = nextEditionDate(date);
      expect(weekday(next)).toBe(weekday(date));
      expect(Number(next.slice(0, 4))).toBe(Number(date.slice(0, 4)) + 1);
    }
    expect(nextEditionDate('2027-03-01')).toBe('2028-02-28');
    // 1er janvier : 52 semaines restent dans l'année, on en prend 53.
    expect(nextEditionDate('2026-01-01')).toBe('2027-01-07');
    expect(nextEditionDate('2028-01-02')).toBe('2029-01-07');
    expect(addDays('2026-11-16', -7)).toBe('2026-11-09');
  });

  it('lit le jour de Paris, minuit passé compris', () => {
    expect(parisDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(parisDate(new Date('2026-07-04T21:59:00Z'))).toBe('2026-07-04');
  });

  it('lit l’heure de Paris, heure d’été comprise', () => {
    expect(parisTime(new Date('2026-07-04T07:30:00Z'))).toBe('09:30');
    expect(parisTime(new Date('2026-11-09T08:00:00Z'))).toBe('09:00');
  });
});
