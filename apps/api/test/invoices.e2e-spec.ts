import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { signStripePayload } from '../src/payments/stripe-signature.js';
import { STRIPE } from '../src/registrations/registrations.tokens.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

class FakeStripe {
  enabled = true;
  livemode = false;
  inputs: Record<string, unknown>[] = [];
  createCheckoutSession = vi.fn((input: Record<string, unknown>) => {
    this.inputs.push(input);
    const id = `cs_invoice_${this.inputs.length}`;
    return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
  });
}

const SLUG = 'challenge-u13-arve';
const CLUB = 'etoile-de-l-arve';

const billing = {
  legalName: 'Association Étoile de l’Arve',
  street: '12 rue du Stade',
  postalCode: '74300',
  city: 'Cluses',
  siret: '123 456 789 00012',
  vatRegistered: false,
};

describe('Factures des packs sponsors (e2e)', () => {
  const WEBHOOK_SECRET = `whsec_${randomBytes(16).toString('hex')}`;
  const stripe = new FakeStripe();
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let token: string;

  beforeAll(async () => {
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    const ctx = await createTestApp([{ provide: STRIPE, useValue: stripe }]);
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    await prisma.stripeEvent.deleteMany();
    stripe.inputs = [];
    await prisma.organization.update({
      where: { slug: CLUB },
      data: { stripeAccountId: 'acct_etoile', stripeChargesEnabled: true },
    });
    token = await login(app);
  });
  afterAll(async () => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    await app.close();
  });

  const organizer = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: object,
    as = token,
  ) =>
    app.inject({
      method,
      url: `/api/v1/organizer${url}`,
      headers: { authorization: `Bearer ${as}`, 'x-organization': CLUB },
      ...(payload ? { payload } : {}),
    });
  const NOW_SECONDS = Math.floor(DEMO_NOW.getTime() / 1000);
  const webhook = (object: Record<string, unknown>) => {
    const body = JSON.stringify({
      id: `evt_${randomBytes(8).toString('hex')}`,
      type: 'checkout.session.completed',
      created: NOW_SECONDS,
      livemode: false,
      data: { object },
    });
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/stripe/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(
          body,
          WEBHOOK_SECRET,
          NOW_SECONDS,
        ),
      },
      payload: body,
    });
  };

  /** Sponsor invité sur le pack Bronze (150 €), payé en ligne avec son adresse. */
  const paidOnline = async (name: string, n: number) => {
    const invited = await organizer('POST', `/tournaments/${SLUG}/sponsors`, {
      name,
      email: `compta${n}@sponsor.test`,
      tier: 'BRONZE',
    });
    const { id, inviteUrl } = invited.json<{ id: string; inviteUrl: string }>();
    const link = inviteUrl.split('/sponsor/')[1]!;
    const checkout = await app.inject({
      method: 'POST',
      url: `/api/v1/public/sponsor-invitations/${link}/checkout`,
      payload: { email: `compta${n}@sponsor.test` },
    });
    expect(checkout.statusCode).toBe(200);
    const res = await webhook({
      id: `cs_invoice_${stripe.inputs.length}`,
      payment_status: 'paid',
      payment_intent: `pi_invoice_${n}`,
      amount_total: 16100,
      currency: 'eur',
      livemode: false,
      customer_details: {
        email: `compta${n}@sponsor.test`,
        name: `${name} SARL`,
        address: {
          line1: '3 quai du Lac',
          line2: 'Bâtiment B',
          postal_code: '74000',
          city: 'Annecy',
          country: 'FR',
        },
      },
      metadata: { sponsorship: id },
    });
    expect(res.statusCode).toBe(200);
    return id;
  };

  it('le propriétaire renseigne l’identité du club ; les mentions obligatoires sont vérifiées', async () => {
    const empty = await organizer('GET', '/billing');
    expect(empty.json()).toMatchObject({
      complete: false,
      vatRegistered: false,
      vatExemptionNote: 'TVA non applicable, art. 293 B du CGI',
      nextNumber: 'FA-2026-0001',
    });
    // Ni SIRET ni RNA ; assujetti sans numéro de TVA.
    const missing = await organizer('PUT', '/billing', {
      ...billing,
      siret: '',
      vatRegistered: true,
    });
    expect(missing.statusCode).toBe(400);
    expect(JSON.stringify(missing.json())).toContain('SIRET');
    expect(JSON.stringify(missing.json())).toContain('intracommunautaire');

    const admin = await login(app, 'admin@example.org');
    expect(
      (await organizer('PUT', '/billing', billing, admin)).statusCode,
    ).toBe(404);
    expect(
      (await organizer('GET', '/billing', undefined, admin)).statusCode,
    ).toBe(200);

    const saved = await organizer('PUT', '/billing', billing);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      legalName: 'Association Étoile de l’Arve',
      siret: '12345678900012',
      complete: true,
    });
  });

  it('un pack payé en ligne reçoit une facture numérotée, envoyée au sponsor avec un lien personnel', async () => {
    await organizer('PUT', '/billing', billing);
    const before = mailbox.length;
    const id = await paidOnline('Traiteur du Lac', 1);
    expect(stripe.inputs[0]).toMatchObject({ billingAddress: true });

    const rows = (
      await organizer('GET', `/tournaments/${SLUG}/sponsors`)
    ).json<{
      sponsors: { id: string; invoiceNumber: string | null }[];
    }>().sponsors;
    expect(rows.find((r) => r.id === id)?.invoiceNumber).toBe('FA-2026-0001');

    const receipt = mailbox
      .slice(before)
      .find(
        (m) => m.to === 'compta1@sponsor.test' && m.subject.startsWith('Reçu'),
      )!;
    const url = receipt.text.match(/https?:\/\/\S+\/facture\/[\w-]+/)![0];
    const publicView = await app.inject({
      method: 'GET',
      url: `/api/v1/public/invoices/${url.split('/facture/')[1]}`,
    });
    expect(publicView.statusCode).toBe(200);
    expect(publicView.json()).toMatchObject({
      number: 'FA-2026-0001',
      seller: {
        legalName: 'Association Étoile de l’Arve',
        siret: '12345678900012',
        vatNumber: null,
      },
      buyer: {
        name: 'Traiteur du Lac SARL',
        street: '3 quai du Lac\nBâtiment B',
        postalCode: '74000',
        city: 'Annecy',
      },
      // Pack seul : les frais de service ne sont pas vendus par le club.
      netCents: 15000,
      vatRate: 0,
      vatCents: 0,
      totalCents: 15000,
      vatNote: 'TVA non applicable, art. 293 B du CGI',
      paidOnline: true,
    });
    expect(publicView.json().label).toContain(
      "Pack partenaire Bronze · Challenge U13 de l'Arve",
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/public/invoices/inconnu',
        })
      ).statusCode,
    ).toBe(404);

    // Club assujetti : TVA de 20 % extraite du prix ; numéro suivant, sans trou.
    await organizer('PUT', '/billing', {
      ...billing,
      vatRegistered: true,
      vatNumber: 'FR 32 123456789',
    });
    await paidOnline('Fromagerie du Val', 2);
    const second = await organizer('GET', '/invoices/FA-2026-0002');
    expect(second.json()).toMatchObject({
      netCents: 12500,
      vatRate: 20,
      vatCents: 2500,
      totalCents: 15000,
      vatNote: null,
      seller: { vatNumber: 'FR32123456789' },
    });
    const list = await organizer('GET', '/invoices?limit=1');
    expect(list.json()).toMatchObject({
      items: [{ number: 'FA-2026-0002', sponsor: 'Fromagerie du Val SARL' }],
    });
    const next = await organizer(
      'GET',
      `/invoices?limit=1&cursor=${list.json().nextCursor}`,
    );
    expect(next.json()).toMatchObject({
      items: [{ number: 'FA-2026-0001' }],
      nextCursor: null,
    });
    expect((await organizer('GET', '/billing')).json().nextNumber).toBe(
      'FA-2026-0003',
    );
  });

  it('sans identité complète, la facture attend le club, qui l’établit ensuite', async () => {
    const before = mailbox.length;
    const id = await paidOnline('Traiteur du Lac', 3);
    const mails = mailbox.slice(before);
    expect(
      mails.find(
        (m) => m.to === 'compta3@sponsor.test' && m.subject.startsWith('Reçu'),
      )?.text,
    ).toContain('le club vous l’enverra');
    expect(mails.find((m) => m.to === 'orga@example.org')?.text).toContain(
      'complétez l’identité de facturation',
    );
    expect(
      (await organizer('POST', `/tournament-sponsors/${id}/invoice`, {}))
        .statusCode,
    ).toBe(409);

    await organizer('PUT', '/billing', billing);
    const issued = await organizer(
      'POST',
      `/tournament-sponsors/${id}/invoice`,
      {},
    );
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toMatchObject({ number: 'FA-2026-0001' });
    expect(mailbox.at(-1)).toMatchObject({
      to: 'compta3@sponsor.test',
      subject: expect.stringContaining('FA-2026-0001'),
    });
    // Rejouer rend la même facture, sans nouveau numéro.
    const again = await organizer(
      'POST',
      `/tournament-sponsors/${id}/invoice`,
      {},
    );
    expect(again.json().number).toBe('FA-2026-0001');
    expect(await prisma.invoice.count()).toBe(1);
  });

  it('un pack réglé directement au club : l’adresse du sponsor est demandée', async () => {
    await organizer('PUT', '/billing', billing);
    const paid = await prisma.tournamentSponsor.findFirstOrThrow({
      where: { tournament: { slug: SLUG }, status: 'PAID' },
      include: { sponsor: true },
    });
    const url = `/tournament-sponsors/${paid.id}/invoice`;
    expect((await organizer('POST', url, {})).statusCode).toBe(409);
    const issued = await organizer('POST', url, {
      buyer: {
        street: '1 place de l’Église',
        postalCode: '74950',
        city: 'Scionzier',
      },
    });
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toMatchObject({
      buyer: { name: paid.sponsor.name, city: 'Scionzier', country: 'FR' },
      paidOnline: false,
    });

    // Hors du club : 404 ; un pack non payé n'a pas de facture.
    const other = await login(app, 'benevole@example.org');
    expect((await organizer('POST', url, {}, other)).statusCode).toBe(404);
    const invited = await organizer('POST', `/tournaments/${SLUG}/sponsors`, {
      name: 'Garage des Cimes',
      tier: 'BRONZE',
    });
    expect(
      (
        await organizer(
          'POST',
          `/tournament-sponsors/${invited.json().id}/invoice`,
          {},
        )
      ).statusCode,
    ).toBe(409);
  });
});
