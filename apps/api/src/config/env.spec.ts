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

  it('refuse un jeton organisateur trop court', () => {
    expect(() =>
      validateEnv({ ...base, ORGANIZER_DEMO_TOKEN: 'court' }),
    ).toThrow(/Configuration invalide/);
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
