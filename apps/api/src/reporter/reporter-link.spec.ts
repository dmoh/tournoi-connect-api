import { createHmac } from 'node:crypto';
import { LINK_TTL_MS, ReporterLinkSigner } from './reporter-link.js';

describe('ReporterLinkSigner', () => {
  const secret = 'un-secret-de-test-assez-long-pour-hmac';
  const signer = new ReporterLinkSigner(secret);
  const now = new Date('2026-11-09T10:00:00Z');
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  const token = signer.sign('lien-1', expiresAt);

  it('ouvre le lien d’un jeton intact et en cours de validité', () => {
    expect(signer.verify(token, now)).toBe('lien-1');
  });

  it('refuse un lien expiré, modifié ou signé par une autre clé', () => {
    expect(
      signer.verify(token, new Date(now.getTime() + LINK_TTL_MS + 1000)),
    ).toBeNull();
    expect(signer.verify(token.replace('lien-1', 'lien-2'), now)).toBeNull();
    const [id, exp, signature] = token.split('.');
    // Expiration repoussée à la main : la signature ne correspond plus.
    expect(
      signer.verify(`${id}.${Number(exp) + 86_400}.${signature}`, now),
    ).toBeNull();
    expect(signer.verify(`${id}.${exp}.${signature}x`, now)).toBeNull();
    expect(signer.verify(`${token}.extra`, now)).toBeNull();
    expect(
      new ReporterLinkSigner('une-autre-cle-tout-aussi-longue').verify(
        token,
        now,
      ),
    ).toBeNull();
    expect(signer.verify('a6-demo', now)).toBeNull();
  });

  it('refuse les liens v1, signés sur le match sans trace en base', () => {
    const v1Key = createHmac('sha256', secret)
      .update('reporter-link/v1')
      .digest();
    const payload = `match-1.${Math.floor(expiresAt.getTime() / 1000)}`;
    const v1 = `${payload}.${createHmac('sha256', v1Key).update(payload).digest('base64url')}`;
    expect(signer.verify(v1, now)).toBeNull();
  });
});
