import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/** Durée d'un jeton d'accès : court, il vit en mémoire dans la PWA. */
export const ACCESS_TTL_SECONDS = 15 * 60;
/** Durée d'une session sans activité (jeton de rafraîchissement). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Code de connexion : 6 chiffres, 10 minutes, 5 essais. */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** Au plus 5 codes par adresse et par heure. */
export const CODES_PER_HOUR = 5;

export interface AccessClaims {
  /** Compte. */
  sub: string;
  /** Session, pour la révoquer. */
  sid: string;
}

/**
 * Clés dérivées du secret des comptes : une par usage, pour qu'une fuite de
 * l'une (ex. une empreinte de code) ne serve à rien d'autre.
 */
export class AuthKeys {
  private readonly access: Uint8Array;
  private readonly codes: Buffer;
  readonly reporter: string;
  readonly oauth: Uint8Array;

  constructor(secret: string) {
    const derive = (usage: string) =>
      createHmac('sha256', secret).update(usage).digest();
    this.access = new Uint8Array(derive('access-token/v1'));
    this.codes = derive('login-code/v1');
    this.oauth = new Uint8Array(derive('oauth-state/v1'));
    this.reporter = derive('reporter-link/v1').toString('base64url');
  }

  signAccess(claims: AccessClaims, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TTL_SECONDS)
      .setIssuer('tournoi-connect')
      .setAudience('tournoi-connect')
      .sign(this.access);
  }

  async verifyAccess(token: string, now: Date): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.access, {
        issuer: 'tournoi-connect',
        audience: 'tournoi-connect',
        algorithms: ['HS256'],
        currentDate: now,
      });
      return typeof payload.sub === 'string' &&
        typeof payload['sid'] === 'string'
        ? { sub: payload.sub, sid: payload['sid'] }
        : null;
    } catch {
      return null;
    }
  }

  /** Empreinte d'un code, liée à l'adresse : un code ne vaut que pour elle. */
  hashCode(email: string, code: string): string {
    return createHmac('sha256', this.codes)
      .update(`${email}:${code}`)
      .digest('base64url');
  }

  sameHash(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}

/** Code à 6 chiffres, tiré uniformément. */
export function newLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Jeton de rafraîchissement opaque et son empreinte (seule l'empreinte est en base). */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefresh(token) };
}

export function hashRefresh(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
