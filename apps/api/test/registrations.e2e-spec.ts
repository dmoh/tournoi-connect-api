import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { signStripePayload } from '../src/payments/stripe-signature.js';
import { STRIPE } from '../src/registrations/registrations.tokens.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

/** Faux Stripe : enregistre les sessions demandées, sans réseau. */
class FakeStripe {
  enabled = true;
  sessions: {
    id: string;
    destination: string;
    fee: number;
    total: number;
    expiresAt: Date;
  }[] = [];
  createAccount = vi.fn(() => Promise.resolve({ id: 'acct_club_test' }));
  accountLink = vi.fn(() =>
    Promise.resolve({ url: 'https://connect.stripe.test/onboarding' }),
  );
  retrieveAccount = vi.fn(() =>
    Promise.resolve({
      id: 'acct_club_test',
      charges_enabled: true,
      details_submitted: true,
    }),
  );
  createCheckoutSession = vi.fn(
    (input: {
      destination: string;
      applicationFeeCents: number;
      lines: { amountCents: number }[];
      expiresAt: Date;
    }) => {
      const id = `cs_test_${this.sessions.length + 1}`;
      this.sessions.push({
        id,
        destination: input.destination,
        fee: input.applicationFeeCents,
        total: input.lines.reduce((sum, l) => sum + l.amountCents, 0),
        expiresAt: input.expiresAt,
      });
      return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
    },
  );
}

describe('Inscriptions et paiements (e2e)', () => {
  const WEBHOOK_SECRET = `whsec_${randomBytes(16).toString('hex')}`;
  const stripe = new FakeStripe();
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    const ctx = await createTestApp([{ provide: STRIPE, useValue: stripe }]);
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    stripe.sessions = [];
    // Le club du tournoi du 11 novembre encaisse en ligne.
    await prisma.organization.update({
      where: { slug: 'stade-du-mont-blanc' },
      data: { stripeAccountId: 'acct_club_test', stripeChargesEnabled: true },
    });
  });
  afterAll(async () => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    await app.close();
  });

  const form = {
    teamName: 'Les Aigles d’Annecy',
    club: 'FC Annecy',
    managerName: 'Léa Martin',
    phone: '06 12 34 56 78',
    players: [
      { firstName: 'Tom', lastName: 'Roux', number: '9' },
      { firstName: 'Nina', lastName: 'Blanc', number: '' },
    ],
    acceptRules: true,
  };
  const register = (
    code: string,
    token: string,
    key = randomBytes(8).toString('hex'),
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${code}/registrations`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      payload: form,
    });
  const webhook = (event: object, secret = WEBHOOK_SECRET) => {
    const body = JSON.stringify(event);
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/stripe/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(
          body,
          secret,
          Math.floor(DEMO_NOW.getTime() / 1000),
        ),
      },
      payload: body,
    });
  };

  it('lit le lien d’inscription : prix avec frais, places, paiements', async () => {
    const invite = await app.inject({
      method: 'GET',
      url: '/api/v1/public/registrations/tournoi-11-novembre-u15',
    });
    expect(invite.json()).toMatchObject({
      code: 'tournoi-11-novembre-u15',
      quote: { feeCents: 12000, serviceFeeCents: 890, totalCents: 12890 },
      open: true,
      full: false,
      paymentsReady: true,
    });
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/public/registrations/coupe-noel-u11-bonneville',
    });
    expect(other.json().paymentsReady).toBe(false);
  });

  it('tient la place pendant le paiement, puis inscrit l’équipe au webhook', async () => {
    const token = await login(app, 'lea@example.com');
    const key = randomBytes(8).toString('hex');
    const created = await register('tournoi-11-novembre-u15', token, key);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'PENDING_PAYMENT',
      checkoutUrl: 'https://checkout.stripe.test/cs_test_1',
      quote: { totalCents: 12890 },
    });
    // Argent au club, frais de service à la plateforme.
    expect(stripe.sessions[0]).toMatchObject({
      destination: 'acct_club_test',
      fee: 890,
      total: 12890,
    });
    // Un renvoi (coupure réseau) rend la même inscription.
    expect(
      (await register('tournoi-11-novembre-u15', token, key)).json().orderId,
    ).toBe(created.json().orderId);
    expect(stripe.sessions).toHaveLength(1);

    // Webhook mal signé : refusé, rien ne change.
    const forged = await webhook(
      {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_1', payment_status: 'paid' } },
      },
      'whsec_autre_secret_0000000000',
    );
    expect(forged.statusCode).toBe(401);

    const paid = await webhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          payment_status: 'paid',
          payment_intent: 'pi_1',
        },
      },
    });
    expect(paid.statusCode).toBe(200);
    // Webhook rejoué par Stripe : sans effet.
    await webhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          payment_status: 'paid',
          payment_intent: 'pi_1',
        },
      },
    });

    const mine = await app.inject({
      method: 'GET',
      url: '/api/v1/registrations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mine.json()).toEqual([
      expect.objectContaining({
        teamName: 'Les Aigles d’Annecy',
        status: 'CONFIRMED',
      }),
    ]);
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: 'tournoi-11-novembre-u15' },
      include: {
        teams: {
          include: { players: true },
          where: { name: 'Les Aigles d’Annecy' },
        },
      },
    });
    expect(tournament.teamCount).toBe(11);
    expect(tournament.teams[0]).toMatchObject({
      code: 'aiglesan',
      shortName: 'AA',
      club: 'FC Annecy',
    });
    expect(tournament.teams[0]?.players.map((p) => p.number).sort()).toEqual([
      2, 9,
    ]);
    expect(mailbox.findLast((m) => m.to === 'lea@example.com')?.subject).toBe(
      'Les Aigles d’Annecy est inscrite au Tournoi du 11-Novembre U15',
    );
  });

  it('rend la place d’un paiement expiré et permet de reprendre', async () => {
    const token = await login(app, 'lea@example.com');
    const created = (await register('tournoi-11-novembre-u15', token)).json();
    await webhook({
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_test_1' } },
    });
    const view = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${created.orderId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(view.json()).toMatchObject({ status: 'EXPIRED' });
    expect(view.json().checkoutUrl).toBeUndefined();

    const retried = await app.inject({
      method: 'POST',
      url: `/api/v1/registrations/${created.orderId}/checkout`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(retried.json()).toMatchObject({
      status: 'PENDING_PAYMENT',
      checkoutUrl: 'https://checkout.stripe.test/cs_test_2',
    });
  });

  it('met en liste d’attente quand le tournoi est complet, refuse sans paiements', async () => {
    const token = await login(app, 'lea@example.com');
    await prisma.organization.update({
      where: { slug: 'entente-du-chablais' },
      data: { stripeAccountId: 'acct_chablais', stripeChargesEnabled: true },
    });
    const full = await register('volley-indoor-thonon', token);
    expect(full.json()).toMatchObject({
      status: 'WAITLISTED',
      waitlistPosition: 1,
    });
    expect(full.json().checkoutUrl).toBeUndefined();

    const closed = await register('coupe-noel-u11-bonneville', token);
    expect(closed.statusCode).toBe(503);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/tournaments/tournoi-11-novembre-u15/registrations',
          headers: { authorization: `Bearer ${token}` },
          payload: form,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('inscrit directement à un tournoi gratuit', async () => {
    await prisma.tournament.update({
      where: { slug: 'coupe-noel-u11-bonneville' },
      data: { feeCents: 0 },
    });
    const token = await login(app, 'lea@example.com');
    const created = await register('coupe-noel-u11-bonneville', token);
    expect(created.json()).toMatchObject({
      status: 'CONFIRMED',
      quote: { totalCents: 0 },
    });
    expect(stripe.sessions).toHaveLength(0);
  });

  it('montre les inscriptions au club et active ses paiements', async () => {
    const lea = await login(app, 'lea@example.com');
    await register('tournoi-11-novembre-u15', lea);
    const owner = await login(app, 'multi@example.org');
    const club = { 'x-organization': 'stade-du-mont-blanc' };
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/tournaments/tournoi-11-novembre-u15/registrations',
      headers: { authorization: `Bearer ${owner}`, ...club },
    });
    expect(list.json()).toEqual([
      expect.objectContaining({
        teamName: 'Les Aigles d’Annecy',
        email: 'lea@example.com',
        players: 2,
        status: 'PENDING_PAYMENT',
      }),
    ]);

    await prisma.organization.update({
      where: { slug: 'stade-du-mont-blanc' },
      data: { stripeAccountId: null, stripeChargesEnabled: false },
    });
    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/payments',
      headers: { authorization: `Bearer ${owner}`, ...club },
    });
    expect(status.json()).toEqual({
      available: true,
      connected: false,
      chargesEnabled: false,
    });
    const onboarding = await app.inject({
      method: 'POST',
      url: '/api/v1/organizer/payments/onboarding',
      headers: { authorization: `Bearer ${owner}`, ...club },
    });
    expect(onboarding.json()).toEqual({
      url: 'https://connect.stripe.test/onboarding',
    });
    await webhook({
      type: 'account.updated',
      data: { object: { id: 'acct_club_test', charges_enabled: true } },
    });
    expect(
      (
        await prisma.organization.findUniqueOrThrow({
          where: { slug: 'stade-du-mont-blanc' },
        })
      ).stripeChargesEnabled,
    ).toBe(true);
  });
});
