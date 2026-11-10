/** Cookie du jeton de rafraîchissement : limité aux routes /auth de l'API. */
export const REFRESH_COOKIE = 'tc_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
/** Cookie de l'aller-retour chez Google, Apple ou Facebook (state, nonce, PKCE). */
export const OAUTH_COOKIE = 'tc_oauth';
export const OAUTH_COOKIE_PATH = '/api/v1/auth/oauth';

export interface CookieOptions {
  maxAgeSeconds: number;
  path: string;
  secure: boolean;
  /** Strict pour la session ; None pour Apple, qui revient en POST depuis son domaine. */
  sameSite: 'Strict' | 'Lax' | 'None';
}

/** En-tête Set-Cookie, HttpOnly toujours : aucun script ne lit ces cookies. */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    'HttpOnly',
    `SameSite=${options.sameSite}`,
    ...(options.secure || options.sameSite === 'None' ? ['Secure'] : []),
  ].join('; ');
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
