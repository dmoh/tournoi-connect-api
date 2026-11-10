import { validateEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://localhost/tournoi' };

describe('validateEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('convertit le port en nombre', () => {
    expect(validateEnv({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it('exige la base de données', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuse un secret des comptes trop court et ignore les variables vides', () => {
    expect(() => validateEnv({ ...base, AUTH_SECRET: 'court' })).toThrow(
      /Configuration invalide/,
    );
    expect(
      validateEnv({ ...base, GOOGLE_CLIENT_ID: '' }).GOOGLE_CLIENT_ID,
    ).toBeUndefined();
    expect(validateEnv(base).MAIL_TRANSPORT).toBe('log');
  });

  it('refuse une configuration mal formée', () => {
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow(
      /Configuration invalide/,
    );
    expect(() =>
      validateEnv({ ...base, PUBLIC_APP_URL: 'pas-une-url' }),
    ).toThrow(/Configuration invalide/);
  });
});
