import { pkceChallenge } from './oauth-providers.js';
import { safeReturnTo } from './oauth.controller.js';

describe('Connexion en un clic', () => {
  it('ne revient qu’à un chemin de la PWA', () => {
    expect(safeReturnTo('/organizer/tournaments?t=1')).toBe(
      '/organizer/tournaments?t=1',
    );
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });

  it('calcule le défi PKCE S256 (vecteur de la RFC 7636)', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
