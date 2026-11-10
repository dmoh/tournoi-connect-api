import {
  AuthKeys,
  hashRefresh,
  newLoginCode,
  newRefreshToken,
  normalizeEmail,
} from './auth-keys.js';
import { readCookie, serializeCookie } from './cookies.js';

describe('AuthKeys', () => {
  const keys = new AuthKeys(
    'un-secret-de-test-de-trente-deux-caracteres-au-moins',
  );
  const now = new Date('2026-11-09T10:00:00Z');

  it('signe un jeton d’accès de 15 minutes et le vérifie', async () => {
    const token = await keys.signAccess({ sub: 'u1', sid: 's1' }, now);
    expect(await keys.verifyAccess(token, now)).toEqual({
      sub: 'u1',
      sid: 's1',
    });
    expect(
      await keys.verifyAccess(token, new Date(now.getTime() + 16 * 60 * 1000)),
    ).toBeNull();
    const other = new AuthKeys(
      'un-autre-secret-de-trente-deux-caracteres-au-moins',
    );
    expect(await other.verifyAccess(token, now)).toBeNull();
  });

  it('lie l’empreinte d’un code à son adresse', () => {
    const hash = keys.hashCode('a@b.fr', '123456');
    expect(keys.sameHash(hash, keys.hashCode('a@b.fr', '123456'))).toBe(true);
    expect(keys.sameHash(hash, keys.hashCode('c@b.fr', '123456'))).toBe(false);
  });

  it('tire des codes à 6 chiffres et des jetons opaques', () => {
    expect(newLoginCode()).toMatch(/^\d{6}$/);
    const { token, hash } = newRefreshToken();
    expect(hashRefresh(token)).toBe(hash);
    expect(normalizeEmail('  Léa@Club.FR ')).toBe('léa@club.fr');
  });
});

describe('cookies', () => {
  it('écrit un cookie HttpOnly et le relit', () => {
    const header = serializeCookie('tc_refresh', 'a b', {
      maxAgeSeconds: 60,
      path: '/api/v1/auth',
      secure: true,
      sameSite: 'Strict',
    });
    expect(header).toBe(
      'tc_refresh=a%20b; Path=/api/v1/auth; Max-Age=60; HttpOnly; SameSite=Strict; Secure',
    );
    expect(readCookie('x=1; tc_refresh=a%20b', 'tc_refresh')).toBe('a b');
    expect(readCookie(undefined, 'tc_refresh')).toBeNull();
  });
});
