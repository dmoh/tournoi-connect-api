import { StripeClient, StripeError, formEncode } from './stripe-client.js';

describe('Corps des requêtes Stripe', () => {
  it('encode objets et tableaux en clés imbriquées', () => {
    expect(
      decodeURIComponent(
        formEncode({
          mode: 'payment',
          line_items: [{ quantity: 1, price_data: { unit_amount: 6000 } }],
          metadata: { registration: 'r1' },
          skipped: undefined,
        }).join('&'),
      ),
    ).toBe(
      'mode=payment&line_items[0][quantity]=1&line_items[0][price_data][unit_amount]=6000&metadata[registration]=r1',
    );
  });
});

describe('Client Stripe', () => {
  const KEY = ['sk', 'test', 'cle_factice_0000000000'].join('_');
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('déduit le mode réel de la clé', () => {
    expect(new StripeClient(KEY).livemode).toBe(false);
    expect(new StripeClient(['rk', 'live', 'x'].join('_')).livemode).toBe(true);
    expect(new StripeClient(null).livemode).toBe(false);
  });

  it('rembourse une charge de destination : virement repris, commission rendue', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 're_1', status: 'succeeded' })),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const refund = await new StripeClient(KEY).createRefund({
      paymentIntent: 'pi_1',
      metadata: { registration: 'r1' },
      idempotencyKey: 'refund-pi_1',
    });
    expect(refund.id).toBe('re_1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'refund-pi_1' });
    expect(decodeURIComponent(init.body as string)).toBe(
      'payment_intent=pi_1&reverse_transfer=true&refund_application_fee=true&metadata[registration]=r1',
    );
  });

  it('remonte l’erreur de Stripe avec son code', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: 'Charge already refunded',
              code: 'charge_already_refunded',
            },
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(
      new StripeClient(KEY).createRefund({
        paymentIntent: 'pi_1',
        metadata: {},
        idempotencyKey: 'refund-pi_1',
      }),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof StripeError &&
        error.status === 400 &&
        error.code === 'charge_already_refunded',
    );
  });
});
