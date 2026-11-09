import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('convertit le port en nombre', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('refuse une configuration mal formée', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(
      /Configuration invalide/,
    );
    expect(() => validateEnv({ PUBLIC_APP_URL: 'pas-une-url' })).toThrow(
      /Configuration invalide/,
    );
  });
});
