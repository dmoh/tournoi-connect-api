import { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { StripeError } from '../src/payments/stripe-client.js';
import { signStripePayload } from '../src/payments/stripe-signature.js';
import { STRIPE } from '../src/registrations/registrations.tokens.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

/** Faux Stripe : enregistre les sessions et remboursements demandés, sans réseau. */
class FakeStripe {
  enabled = true;
  livemode = false;
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
  createRefund = vi.fn(
    (_input: {
      paymentIntent: string;
      metadata: Record<string, string>;
      idempotencyKey: string;
    }) => Promise.resolve({ id: 're_test_1', status: 'succeeded' }),
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
    // Événements traités : seedDemo ne les connaît pas (ordre des account.updated).
    await prisma.stripeEvent.deleteMany();
    stripe.sessions = [];
    stripe.createRefund.mockClear();
    stripe.createCheckoutSession.mockClear();
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
  const NOW_SECONDS = Math.floor(DEMO_NOW.getTime() / 1000);
  const webhook = (
    event: object,
    secret = WEBHOOK_SECRET,
    timestamp = NOW_SECONDS,
  ) => {
    const body = JSON.stringify(event);
    return app.inject({
      method: 'POST',
      url: '/api/v1/payments/stripe/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signStripePayload(body, secret, timestamp),
      },
      payload: body,
    });
  };
  /** Événement Stripe à identifiant neuf (la table des événements traités n'est pas remise à zéro). */
  const stripeEvent = (
    type: string,
    object: Record<string, unknown>,
    created = NOW_SECONDS,
  ) => ({
    id: `evt_${randomBytes(8).toString('hex')}`,
    type,
    created,
    livemode: false,
    data: { object },
  });
  /** Session Checkout payée du montant attendu (120 € + 8,90 € de frais). */
  const paidSession = (
    id: string,
    paymentIntent: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    payment_status: 'paid',
    payment_intent: paymentIntent,
    amount_total: 12890,
    currency: 'eur',
    livemode: false,
    ...extra,
  });
  const statusOf = async (id: string) =>
    (await prisma.registration.findUniqueOrThrow({ where: { id } })).status;
  const teamCount = async () =>
    (
      await prisma.tournament.findUniqueOrThrow({
        where: { slug: 'tournoi-11-novembre-u15' },
      })
    ).teamCount;

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
      stripeEvent(
        'checkout.session.completed',
        paidSession('cs_test_1', 'pi_1'),
      ),
      'whsec_autre_secret_0000000000',
    );
    expect(forged.statusCode).toBe(401);

    const completed = stripeEvent(
      'checkout.session.completed',
      paidSession('cs_test_1', 'pi_1'),
    );
    const paid = await webhook(completed);
    expect(paid.statusCode).toBe(200);
    // Webhook rejoué par Stripe (même événement, ou nouvel envoi du même paiement) : sans effet.
    expect((await webhook(completed)).statusCode).toBe(200);
    await webhook(
      stripeEvent(
        'checkout.session.completed',
        paidSession('cs_test_1', 'pi_1'),
      ),
    );
    expect(stripe.createRefund).not.toHaveBeenCalled();

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
    expect(
      tournament.teams[0]?.players.map((p) => p.number).sort((a, b) => a - b),
    ).toEqual([2, 9]);
    expect(mailbox.findLast((m) => m.to === 'lea@example.com')?.subject).toBe(
      'Les Aigles d’Annecy est inscrite au Tournoi du 11-Novembre U15',
    );
  });

  it('rend la place d’un paiement expiré et permet de reprendre', async () => {
    const token = await login(app, 'lea@example.com');
    const created = (await register('tournoi-11-novembre-u15', token)).json();
    await webhook(stripeEvent('checkout.session.expired', { id: 'cs_test_1' }));
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
    await webhook(
      stripeEvent('account.updated', {
        id: 'acct_club_test',
        charges_enabled: true,
      }),
    );
    expect(
      (
        await prisma.organization.findUniqueOrThrow({
          where: { slug: 'stade-du-mont-blanc' },
        })
      ).stripeChargesEnabled,
    ).toBe(true);
  });

  it('rembourse le paiement arrivé après expiration quand la place a été reprise', async () => {
    // Une seule place restante (10 équipes inscrites).
    await prisma.tournament.update({
      where: { slug: 'tournoi-11-novembre-u15' },
      data: { maxTeams: 11 },
    });
    const lea = await login(app, 'lea@example.com');
    const first = (await register('tournoi-11-novembre-u15', lea)).json();
    await webhook(stripeEvent('checkout.session.expired', { id: 'cs_test_1' }));

    const marc = await login(app, 'marc@example.com');
    const second = (await register('tournoi-11-novembre-u15', marc)).json();
    expect(second.status).toBe('PENDING_PAYMENT');
    await webhook(
      stripeEvent(
        'checkout.session.completed',
        paidSession('cs_test_2', 'pi_2'),
      ),
    );
    expect(await statusOf(second.orderId)).toBe('CONFIRMED');
    expect(await teamCount()).toBe(11);

    // Léa avait payé juste avant l'expiration : son webhook arrive maintenant.
    const late = stripeEvent(
      'checkout.session.completed',
      paidSession('cs_test_1', 'pi_1', {
        metadata: { registration: first.orderId },
      }),
    );
    expect((await webhook(late)).statusCode).toBe(200);
    expect(await teamCount()).toBe(11);
    const refunded = await prisma.registration.findUniqueOrThrow({
      where: { id: first.orderId },
    });
    expect(refunded).toMatchObject({
      status: 'CANCELLED',
      paymentIntentId: 'pi_1',
      teamId: null,
    });
    expect(refunded.paidAt).not.toBeNull();
    expect(stripe.createRefund).toHaveBeenCalledExactlyOnceWith({
      paymentIntent: 'pi_1',
      metadata: { registration: first.orderId, session: 'cs_test_1' },
      idempotencyKey: 'refund-pi_1',
    });
    const refundMails = () =>
      mailbox.filter(
        (m) =>
          m.to === 'lea@example.com' &&
          m.subject ===
            'Tournoi du 11-Novembre U15 est complet : votre paiement est remboursé',
      );
    expect(refundMails()).toHaveLength(1);
    expect(refundMails()[0]?.text).toContain('128,90');

    // Le même événement rejoué : un seul remboursement, un seul email.
    expect((await webhook(late)).statusCode).toBe(200);
    expect(stripe.createRefund).toHaveBeenCalledTimes(1);
    expect(refundMails()).toHaveLength(1);
  });

  it('confirme une place expirée encore libre, rembourse un paiement en double', async () => {
    const lea = await login(app, 'lea@example.com');
    const created = (await register('tournoi-11-novembre-u15', lea)).json();
    await webhook(stripeEvent('checkout.session.expired', { id: 'cs_test_1' }));
    await webhook(
      stripeEvent(
        'checkout.session.completed',
        paidSession('cs_test_1', 'pi_1'),
      ),
    );
    expect(await statusOf(created.orderId)).toBe('CONFIRMED');
    expect(await teamCount()).toBe(11);

    // Second paiement de la même inscription (autre session) : remboursé, rien d'autre.
    await webhook(
      stripeEvent(
        'checkout.session.completed',
        paidSession('cs_test_9', 'pi_9', {
          metadata: { registration: created.orderId },
        }),
      ),
    );
    expect(await statusOf(created.orderId)).toBe('CONFIRMED');
    expect(await teamCount()).toBe(11);
    expect(stripe.createRefund).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ paymentIntent: 'pi_9' }),
    );
  });

  it('paiement différé : rien tant qu’il est « unpaid », confirmé à async_payment_succeeded', async () => {
    const lea = await login(app, 'lea@example.com');
    const created = (await register('tournoi-11-novembre-u15', lea)).json();
    const unpaid = await webhook(
      stripeEvent(
        'checkout.session.completed',
        paidSession('cs_test_1', 'pi_1', { payment_status: 'unpaid' }),
      ),
    );
    expect(unpaid.statusCode).toBe(200);
    expect(await statusOf(created.orderId)).toBe('PENDING_PAYMENT');
    expect(await teamCount()).toBe(10);

    await webhook(
      stripeEvent(
        'checkout.session.async_payment_succeeded',
        paidSession('cs_test_1', 'pi_1'),
      ),
    );
    expect(await statusOf(created.orderId)).toBe('CONFIRMED');
    expect(await teamCount()).toBe(11);
  });

  it('paiement différé refusé : la place est rendue', async () => {
    const lea = await login(app, 'lea@example.com');
    const created = (await register('tournoi-11-novembre-u15', lea)).json();
    await webhook(
      stripeEvent('checkout.session.async_payment_failed', {
        id: 'cs_test_1',
        payment_status: 'unpaid',
      }),
    );
    expect(await statusOf(created.orderId)).toBe('EXPIRED');
  });

  it('ne confirme pas un montant, une devise ou un mode incohérents', async () => {
    const lea = await login(app, 'lea@example.com');
    const created = (await register('tournoi-11-novembre-u15', lea)).json();
    for (const extra of [
      { amount_total: 100 },
      { currency: 'usd' },
      { livemode: true },
      { amount_total: undefined },
    ]) {
      const response = await webhook(
        stripeEvent(
          'checkout.session.completed',
          paidSession('cs_test_1', 'pi_1', extra),
        ),
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });
    }
    expect(await statusOf(created.orderId)).toBe('PENDING_PAYMENT');
    expect(await teamCount()).toBe(10);
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });

  it('accepte un type inconnu sans effet, ignore un account.updated plus ancien', async () => {
    const unknown = await webhook(
      stripeEvent('customer.created', { id: 'cus_1' }),
    );
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ received: true });

    const charges = async () =>
      (
        await prisma.organization.findUniqueOrThrow({
          where: { slug: 'stade-du-mont-blanc' },
        })
      ).stripeChargesEnabled;
    await webhook(
      stripeEvent(
        'account.updated',
        { id: 'acct_club_test', charges_enabled: false },
        NOW_SECONDS - 10,
      ),
    );
    expect(await charges()).toBe(false);
    await webhook(
      stripeEvent(
        'account.updated',
        { id: 'acct_club_test', charges_enabled: true },
        NOW_SECONDS - 5,
      ),
    );
    // Arrivé en retard, un état plus ancien n'écrase pas le plus récent.
    await webhook(
      stripeEvent(
        'account.updated',
        { id: 'acct_club_test', charges_enabled: false },
        NOW_SECONDS - 8,
      ),
    );
    expect(await charges()).toBe(true);
  });

  it('refuse un webhook sans signature, sans secret configuré ou trop ancien', async () => {
    const lea = await login(app, 'lea@example.com');
    const created = (await register('tournoi-11-novembre-u15', lea)).json();
    const event = stripeEvent(
      'checkout.session.completed',
      paidSession('cs_test_1', 'pi_1'),
    );
    const unsigned = await app.inject({
      method: 'POST',
      url: '/api/v1/payments/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(event),
    });
    expect(unsigned.statusCode).toBe(401);

    expect(
      (await webhook(event, WEBHOOK_SECRET, NOW_SECONDS - 301)).statusCode,
    ).toBe(401);

    const config = app.get(ConfigService);
    const get = config.get.bind(config);
    const spy = vi
      .spyOn(config, 'get')
      .mockImplementation((key: string, ...rest: unknown[]) =>
        key === 'STRIPE_WEBHOOK_SECRET'
          ? undefined
          : (get as (k: string, ...r: unknown[]) => unknown)(key, ...rest),
      );
    try {
      expect((await webhook(event)).statusCode).toBe(401);
    } finally {
      spy.mockRestore();
    }
    expect(await statusOf(created.orderId)).toBe('PENDING_PAYMENT');
    // Signature valide : l'événement, jamais traité, s'applique.
    expect((await webhook(event)).statusCode).toBe(200);
    expect(await statusOf(created.orderId)).toBe('CONFIRMED');
  });

  it('cache le détail d’une erreur Stripe au client', async () => {
    stripe.createCheckoutSession.mockRejectedValueOnce(
      new StripeError(
        'No such destination: acct_club_test',
        400,
        'resource_missing',
      ),
    );
    const lea = await login(app, 'lea@example.com');
    const failed = await register('tournoi-11-novembre-u15', lea);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({
      status: 502,
      detail:
        'Le paiement en ligne est momentanément indisponible. Réessayez dans quelques minutes.',
    });
    expect(failed.body).not.toContain('acct_club_test');
    expect(failed.body).not.toContain('No such destination');
    const [registration] = await prisma.registration.findMany({
      where: { teamName: form.teamName },
    });
    expect(registration?.status).toBe('EXPIRED');
  });
});
