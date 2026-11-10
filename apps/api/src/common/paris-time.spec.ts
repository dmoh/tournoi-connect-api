import { describe, expect, it } from 'vitest';
import { parisDateTime } from './paris-time.js';

describe('parisDateTime', () => {
  it('convertit une heure d’hiver (UTC+1)', () => {
    expect(parisDateTime('2026-12-05', '09:00').toISOString()).toBe(
      '2026-12-05T08:00:00.000Z',
    );
  });

  it('convertit une heure d’été (UTC+2)', () => {
    expect(parisDateTime('2026-04-11', '09:00').toISOString()).toBe(
      '2026-04-11T07:00:00.000Z',
    );
  });
});
