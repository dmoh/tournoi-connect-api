import {
  signStripePayload,
  verifyStripeSignature,
} from './stripe-signature.js';

describe('Signature des webhooks Stripe', () => {
  const secret = 'whsec_test_' + 'x'.repeat(24);
  const now = new Date('2026-11-11T10:00:00Z');
  const t = Math.floor(now.getTime() / 1000);
  const body = '{"type":"checkout.session.completed"}';

  it('accepte le corps signé avec le secret', () => {
    expect(
      verifyStripeSignature(
        body,
        signStripePayload(body, secret, t),
        secret,
        now,
      ),
    ).toBe(true);
  });

  it('refuse un corps modifié, un autre secret ou une signature trop ancienne', () => {
    const header = signStripePayload(body, secret, t);
    expect(verifyStripeSignature(body + ' ', header, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, header, secret + 'y', now)).toBe(false);
    expect(
      verifyStripeSignature(
        body,
        header,
        secret,
        new Date(now.getTime() + 301_000),
      ),
    ).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret, now)).toBe(false);
  });
});
