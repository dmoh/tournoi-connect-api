import { createHmac, timingSafeEqual } from 'node:crypto';

/** Durée de validité d'un lien rapporteur (cahier des charges : 24 heures). */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Lien signé de la table de marque : `<match>.<expiration>.<signature>`,
 * limité à un match et à 24 heures. La clé HMAC est dérivée d'AUTH_SECRET,
 * propre à cet usage (AuthKeys.reporter).
 */
export class ReporterLinkSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHmac('sha256', secret).update('reporter-link/v1').digest();
  }

  sign(matchId: string, expiresAt: Date): string {
    const payload = `${matchId}.${Math.floor(expiresAt.getTime() / 1000)}`;
    return `${payload}.${this.signature(payload)}`;
  }

  /** Identifiant du match si le lien est intact et pas expiré, sinon null. */
  verify(token: string, now: Date): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [matchId, exp, signature] = parts as [string, string, string];
    const expected = Buffer.from(this.signature(`${matchId}.${exp}`));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return null;
    }
    const expiresAt = Number(exp) * 1000;
    return Number.isFinite(expiresAt) && expiresAt > now.getTime()
      ? matchId
      : null;
  }

  private signature(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
