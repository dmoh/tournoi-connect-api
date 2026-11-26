import { buildCalendar, foldLine, icsDate, icsText } from './ics.js';

describe('calendrier iCalendar', () => {
  it('écrit les dates en UTC et échappe le texte', () => {
    expect(icsDate(new Date('2026-12-05T09:30:00+01:00'))).toBe(
      '20261205T083000Z',
    );
    expect(icsText('Stade, Cluses; terrain\\2\nentrée B')).toBe(
      'Stade\\, Cluses\; terrain\\\\2\\nentrée B',
    );
  });

  it('plie les lignes longues à 75 octets sans couper un caractère', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });

  it('assemble un calendrier valide, en CRLF, avec un événement par match', () => {
    const ics = buildCalendar(
      'Les Aigles · Challenge U13',
      [
        {
          uid: 'match-1@tournoi-connect',
          start: new Date('2026-12-05T08:30:00Z'),
          end: new Date('2026-12-05T08:45:00Z'),
          summary: 'Les Aigles – Les Marmottes',
          location: 'Stade des Esserts, Cluses (Terrain 1)',
          description: 'Poule A',
          url: 'https://tournoi-connect.fr/t/challenge/m/a1',
        },
      ],
      new Date('2026-11-27T10:00:00Z'),
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261205T083000Z\r\n');
    expect(ics).toContain(
      'LOCATION:Stade des Esserts\\, Cluses (Terrain 1)\r\n',
    );
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
});
