import { formEncode } from './stripe-client.js';

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
