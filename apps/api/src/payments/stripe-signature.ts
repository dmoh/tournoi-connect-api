import { createHmac, timingSafeEqual } from 'node:crypto';

/** Écart toléré entre l'horodatage de Stripe et l'horloge du serveur. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * En-tête Stripe-Signature (« t=…,v1=… ») d'un corps brut, comme Stripe le
 * calcule : HMAC-SHA256 de « t.corps » avec le secret du webhook.
 */
export function signStripePayload(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  const v1 = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Vrai si l'un des v1 de l'en-tête signe ce corps et que l'horodatage est récent. */
export function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  now: Date,
): boolean {
  if (!header) {
    return false;
  }
  const parts = header
    .split(',')
    .map((p) => p.split('=', 2) as [string, string?]);
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  if (
    Math.abs(now.getTime() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex'),
  );
  return parts
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const given = Buffer.from(v ?? '');
      return (
        given.length === expected.length && timingSafeEqual(given, expected)
      );
    });
}
