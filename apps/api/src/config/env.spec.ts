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

  describe('comptes de test et emails au journal', () => {
    const prod = {
      ...base,
      PUBLIC_APP_URL: 'https://app.tournoi-connect.com',
      MAIL_TRANSPORT: 'ses',
    };
    const preprod = {
      ...prod,
      PUBLIC_APP_URL: 'https://preprod.tournoi-connect.com',
    };

    it('refuse le code fixe et le drapeau en production', () => {
      expect(() =>
        validateEnv({ ...prod, TEST_ACCOUNTS_CODE: '123456' }),
      ).toThrow(/interdits en production/);
      expect(() =>
        validateEnv({
          ...prod,
          PUBLIC_APP_URL: 'https://APP.tournoi-connect.com/',
          TEST_ACCOUNTS_CODE: '123456',
          ALLOW_TEST_ACCOUNTS: 'true',
        }),
      ).toThrow(/interdits en production/);
      expect(() =>
        validateEnv({ ...prod, ALLOW_TEST_ACCOUNTS: 'false' }),
      ).toThrow(/interdits en production/);
      expect(
        validateEnv({ ...prod, TEST_ACCOUNTS_CODE: '' }).MAIL_TRANSPORT,
      ).toBe('ses');
    });

    it('ignore le code fixe sans ALLOW_TEST_ACCOUNTS=true', () => {
      expect(
        validateEnv({ ...preprod, TEST_ACCOUNTS_CODE: '123456' })
          .TEST_ACCOUNTS_CODE,
      ).toBeUndefined();
      expect(
        validateEnv({
          ...preprod,
          TEST_ACCOUNTS_CODE: '123456',
          ALLOW_TEST_ACCOUNTS: 'false',
        }).TEST_ACCOUNTS_CODE,
      ).toBeUndefined();
      expect(
        validateEnv({
          ...preprod,
          TEST_ACCOUNTS_CODE: '123456',
          ALLOW_TEST_ACCOUNTS: 'true',
        }).TEST_ACCOUNTS_CODE,
      ).toBe('123456');
    });

    it('refuse le drapeau sans code et toute autre valeur que true ou false', () => {
      expect(() =>
        validateEnv({ ...preprod, ALLOW_TEST_ACCOUNTS: 'true' }),
      ).toThrow(/exige TEST_ACCOUNTS_CODE/);
      expect(() =>
        validateEnv({
          ...preprod,
          TEST_ACCOUNTS_CODE: '123456',
          ALLOW_TEST_ACCOUNTS: '1',
        }),
      ).toThrow(/Configuration invalide/);
    });

    it('refuse les emails au journal quand la PWA est en https hors localhost', () => {
      expect(() => validateEnv({ ...preprod, MAIL_TRANSPORT: 'log' })).toThrow(
        /MAIL_TRANSPORT/,
      );
      // Valeur par défaut : log, refusée elle aussi.
      expect(() =>
        validateEnv({ ...base, PUBLIC_APP_URL: preprod.PUBLIC_APP_URL }),
      ).toThrow(/MAIL_TRANSPORT/);
      expect(
        validateEnv({ ...base, PUBLIC_APP_URL: 'https://localhost:4200' })
          .MAIL_TRANSPORT,
      ).toBe('log');
      expect(
        validateEnv({ ...base, PUBLIC_APP_URL: 'http://192.168.1.20:4200' })
          .MAIL_TRANSPORT,
      ).toBe('log');
    });
  });
});
