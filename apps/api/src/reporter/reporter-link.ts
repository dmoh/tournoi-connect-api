import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';

/** Durée de validité d'un lien rapporteur (cahier des charges : 24 heures). */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Lien signé de la table de marque : `<lien>.<expiration>.<signature>`, où
 * `<lien>` est l'identifiant de la ligne reporter_link (match, membre qui l'a
 * émis, révocation). La signature évite une lecture en base pour un jeton
 * forgé ou expiré ; la ligne décide ensuite (révoqué, expiré).
 *
 * Clé v2, dérivée d'AUTH_SECRET (AuthKeys.reporter) : les liens v1
 * (`<match>.<expiration>.<signature>`, sans trace en base) ne sont plus
 * acceptés, puisqu'ils ne peuvent pas être révoqués.
 */
export class ReporterLinkSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHmac('sha256', secret).update('reporter-link/v2').digest();
  }

  sign(linkId: string, expiresAt: Date): string {
    const payload = `${linkId}.${Math.floor(expiresAt.getTime() / 1000)}`;
    return `${payload}.${this.signature(payload)}`;
  }

  /** Identifiant du lien s'il est intact et pas expiré, sinon null. */
  verify(token: string, now: Date): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [linkId, exp, signature] = parts as [string, string, string];
    const expected = Buffer.from(this.signature(`${linkId}.${exp}`));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return null;
    }
    const expiresAt = Number(exp) * 1000;
    return Number.isFinite(expiresAt) && expiresAt > now.getTime()
      ? linkId
      : null;
  }

  private signature(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}

/**
 * Révoque les liens encore actifs émis par un membre pour son club : appelé
 * quand il quitte le club ou en est retiré, dans la même transaction.
 */
export function revokeLinksIssuedBy(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
  now: Date,
): Promise<Prisma.BatchPayload> {
  return tx.reporterLink.updateMany({
    where: { issuedById: userId, organizationId, revokedAt: null },
    data: { revokedAt: now },
  });
}
