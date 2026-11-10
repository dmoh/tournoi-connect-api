import { LINK_TTL_MS, ReporterLinkSigner } from './reporter-link.js';

describe('ReporterLinkSigner', () => {
  const signer = new ReporterLinkSigner(
    'un-secret-de-test-assez-long-pour-hmac',
  );
  const now = new Date('2026-11-09T10:00:00Z');
  const token = signer.sign('match-1', new Date(now.getTime() + LINK_TTL_MS));

  it('ouvre le match d’un lien intact et en cours de validité', () => {
    expect(signer.verify(token, now)).toBe('match-1');
  });

  it('refuse un lien expiré, modifié ou signé par une autre clé', () => {
    expect(
      signer.verify(token, new Date(now.getTime() + LINK_TTL_MS + 1000)),
    ).toBeNull();
    expect(signer.verify(token.replace('match-1', 'match-2'), now)).toBeNull();
    expect(
      new ReporterLinkSigner('une-autre-cle-tout-aussi-longue').verify(
        token,
        now,
      ),
    ).toBeNull();
    expect(signer.verify('a6-demo', now)).toBeNull();
  });
});
