import { teamRecapMail, type RecapMatch } from './templates.js';

const base = {
  club: 'Étoile de l’Arve',
  tournament: 'Challenge U13',
  date: 'samedi 11 avril 2026',
  sport: 'football',
  team: 'Les Aigles',
  place: null,
  podium: { first: 'Les Aigles', second: 'FC Cluses', third: ['AS Marnaz'] },
  matches: [] as RecapMatch[],
  photos: 0,
  palmaresUrl: 'https://app.example.org/t/challenge-u13/palmares',
  photosUrl: 'https://app.example.org/t/challenge-u13/photos',
  unsubscribeUrl: 'https://app.example.org/editions/desinscription/x',
  oneClickUrl:
    'https://app.example.org/api/v1/public/edition-invites/x/opt-out',
};

const match = (m: Partial<RecapMatch>): RecapMatch => ({
  stage: 'Poule A',
  opponent: 'FC Cluses',
  scored: 2,
  conceded: 1,
  result: 'W',
  forfeit: false,
  shootout: false,
  ...m,
});

describe('teamRecapMail', () => {
  it('annonce la place dans l’objet, juste sous le nom, et met l’équipe en gras dans le podium', () => {
    const mail = teamRecapMail('a@example.org', { ...base, place: 1 });
    expect(mail.subject).toBe('Les Aigles remporte « Challenge U13 » !');
    expect(mail.text).toMatch(
      /^Challenge U13 · samedi 11 avril 2026\nLes Aigles\nVainqueur du tournoi !/,
    );
    expect(mail.text).toContain('1. Les Aigles\n2. FC Cluses\n3. AS Marnaz');
    expect(mail.html).toContain('font-weight:700">1. Les Aigles</p>');
    expect(mail.html).toContain('<title>');
  });

  it('dit la place des 2e et 3e, et « vos résultats » hors podium', () => {
    expect(teamRecapMail('a@example.org', { ...base, place: 2 }).subject).toBe(
      'Les Aigles termine 2e de « Challenge U13 » !',
    );
    expect(teamRecapMail('a@example.org', base).subject).toBe(
      'Les Aigles à « Challenge U13 » : vos résultats',
    );
  });

  it('résume les matchs : forfaits hors des buts, tirs au but explicites', () => {
    const mail = teamRecapMail('a@example.org', {
      ...base,
      photos: 1,
      matches: [
        match({}),
        match({
          stage: 'Quart de finale',
          scored: 1,
          conceded: 1,
          shootout: true,
        }),
        match({ stage: 'Demi-finale', scored: 3, conceded: 0, forfeit: true }),
        match({ stage: 'Finale', scored: 0, conceded: 2, result: 'L' }),
      ],
    });
    expect(mail.text).toContain(
      '3 victoires, 1 défaite · 3 buts marqués, 4 encaissés',
    );
    expect(mail.text).toContain(
      '- Quart de finale — victoire aux tirs au but 1-1 contre FC Cluses',
    );
    expect(mail.text).toContain(
      '- Demi-finale — victoire par forfait 3-0 contre FC Cluses',
    );
    expect(mail.text).toContain('1 photo du tournoi');
    expect(mail.text).toContain('Étoile de l’Arve via Tournoi Connect');
  });

  it('parle de points au basket et de sets au volley', () => {
    const at = (sport: string) =>
      teamRecapMail('a@example.org', { ...base, sport, matches: [match({})] })
        .text;
    expect(at('basketball')).toContain('2 points marqués, 1 encaissé');
    expect(at('volleyball')).toContain('2 sets gagnés, 1 perdu');
  });
});
