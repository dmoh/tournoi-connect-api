import { registrationQuote, shortName, teamCodeBase } from './pricing.js';

describe('Prix et noms d’équipe', () => {
  it('ajoute 7 % + 0,50 € de frais de service, rien pour un tournoi gratuit', () => {
    expect(registrationQuote(6000)).toEqual({
      feeCents: 6000,
      serviceFeeCents: 470,
      totalCents: 6470,
    });
    expect(registrationQuote(0)).toEqual({
      feeCents: 0,
      serviceFeeCents: 0,
      totalCents: 0,
    });
  });

  it('tire un code et un monogramme du nom', () => {
    expect(teamCodeBase('Les Aigles d’Annecy')).toBe('aiglesan');
    expect(shortName('Les Aigles d’Annecy')).toBe('AA');
    expect(shortName('Cluses')).toBe('CLUS');
  });
});
