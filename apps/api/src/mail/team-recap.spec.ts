import { teamRecapMail, type RecapMatch } from './templates.js';

const base = {
  club: 'Étoile de l’Arve',
  tournament: 'Challenge U13',
  date: 'samedi 11 avril 2026',
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
  ...m,
});

describe('teamRecapMail', () => {
  it('annonce la victoire dans l’objet et le podium dans le texte', () => {
    const mail = teamRecapMail('a@example.org', { ...base, place: 1 });
    expect(mail.subject).toBe('Les Aigles remporte « Challenge U13 » !');
    expect(mail.text).toContain('1. Les Aigles\n2. FC Cluses\n3. AS Marnaz');
  });

  it('dit la place des 2e et 3e, et reste neutre hors podium', () => {
    expect(teamRecapMail('a@example.org', { ...base, place: 2 }).subject).toBe(
      'Les Aigles termine 2e de « Challenge U13 »',
    );
    expect(teamRecapMail('a@example.org', base).subject).toBe(
      'Les Aigles à « Challenge U13 » : votre récapitulatif',
    );
  });

  it('résume les matchs : bilan accordé, forfait et tirs au but', () => {
    const mail = teamRecapMail('a@example.org', {
      ...base,
      photos: 1,
      matches: [
        match({}),
        match({
          stage: 'Quart de finale',
          scored: 1,
          conceded: 1,
          result: 'W',
        }),
        match({
          stage: 'Demi-finale',
          scored: 0,
          conceded: 3,
          result: 'W',
          forfeit: true,
        }),
        match({ stage: 'Finale', scored: 0, conceded: 2, result: 'L' }),
      ],
    });
    expect(mail.text).toContain(
      '3 victoires, 1 défaite · 3 buts marqués, 7 encaissés',
    );
    expect(mail.text).toContain(
      '- Demi-finale — victoire par forfait 0-3 contre FC Cluses',
    );
    expect(mail.text).toContain('1 photo du tournoi');
    expect(mail.html).toContain('<h1');
  });

  it('sans match joué, ni bilan ni liste', () => {
    const mail = teamRecapMail('a@example.org', { ...base, podium: null });
    expect(mail.text).not.toMatch(/victoire|Podium/);
    expect(mail.text).toContain(base.palmaresUrl);
  });
});
