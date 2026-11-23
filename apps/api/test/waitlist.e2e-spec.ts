import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { signStripePayload } from '../src/payments/stripe-signature.js';
import { HOLD_MINUTES } from '../src/registrations/pricing.js';
import { STRIPE } from '../src/registrations/registrations.tokens.js';
import {
  OFFER_HOURS,
  WaitlistService,
} from '../src/registrations/waitlist.service.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

/** Faux Stripe : enregistre les sessions demandées, sans réseau. */
class FakeStripe {
  enabled = true;
  livemode = false;
  sessions: { id: string; expiresAt: Date }[] = [];
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
  createCheckoutSession = vi.fn((input: { expiresAt: Date }) => {
    const id = `cs_test_${this.sessions.length + 1}`;
    this.sessions.push({ id, expiresAt: input.expiresAt });
    return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
  });
  createRefund = vi.fn(() =>
    Promise.resolve({ id: 're_test_1', status: 'succeeded' }),
  );
}

const PAID = 'tournoi-11-novembre-u15';
const FREE = 'coupe-noel-u11-bonneville';
const CLUB = { 'x-organization': 'stade-du-mont-blanc' };
const DUE_AT = new Date(DEMO_NOW.getTime() + OFFER_HOURS * 60 * 60_000);
const HOLD_END = new Date(DEMO_NOW.getTime() + HOLD_MINUTES * 60_000);

describe('Promotion de la liste d’attente (e2e)', () => {
  const WEBHOOK_SECRET = `whsec_${randomBytes(16).toString('hex')}`;
  const stripe = new FakeStripe();
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let waitlist: WaitlistService;

  beforeAll(async () => {
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    const ctx = await createTestApp([{ provide: STRIPE, useValue: stripe }]);
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
    waitlist = app.get(WaitlistService);
  });
  beforeEach(async () => {
    await reset();
    await prisma.stripeEvent.deleteMany();
    stripe.sessions = [];
    stripe.createCheckoutSession.mockClear();
    stripe.createRefund.mockClear();
    mailbox.length = 0;
    await prisma.organization.update({
      where: { slug: 'stade-du-mont-blanc' },
      data: { stripeAccountId: 'acct_club_test', stripeChargesEnabled: true },
    });
  });
  afterAll(async () => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    await app.close();
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const register = async (code: string, token: string, teamName: string) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${code}/registrations`,
      headers: {
        ...auth(token),
        'idempotency-key': randomBytes(8).toString('hex'),
      },
      payload: {
        teamName,
        club: '',
        managerName: 'Responsable',
        phone: '06 12 34 56 78',
        players: [{ firstName: 'Tom', lastName: 'Roux', number: '9' }],
        acceptRules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ orderId: string; status: string }>();
  };
  const webhook = (type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({
      id: `evt_${randomBytes(8).toString('hex')}`,
      type,
      created: Math.floor(DEMO_NOW.getTime() / 1000),
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
          Math.floor(DEMO_NOW.getTime() / 1000),
        ),
      },
      payload: body,
    });
  };
  const expireSession = (id: string) =>
    webhook('checkout.session.expired', { id });
  const view = async (id: string, token: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/registrations/${id}`,
        headers: auth(token),
      })
    ).json();
  const action = (id: string, token: string, verb: 'checkout' | 'decline') =>
    app.inject({
      method: 'POST',
      url: `/api/v1/registrations/${id}/${verb}`,
      headers: auth(token),
    });
  const row = async (id: string) =>
    prisma.registration.findUniqueOrThrow({ where: { id } });
  const capacity = (slug: string, maxTeams: number) =>
    prisma.tournament.update({ where: { slug }, data: { maxTeams } });
  /**
   * Horloge figée : toutes les inscriptions ont la même date. L'ordre
   * d'arrivée est rétabli sur createdAt (la première il y a le plus longtemps).
   */
  const inOrder = async (...ids: string[]) => {
    for (const [i, id] of ids.entries()) {
      await prisma.registration.update({
        where: { id },
        data: {
          createdAt: new Date(DEMO_NOW.getTime() - (ids.length - i) * 60_000),
        },
      });
    }
  };
  const invite = async (code: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/public/registrations/${code}`,
      })
    ).json<{ full: boolean }>();

  /**
   * Une place (11 inscrites max) : Léa la tient pendant son paiement, Marc
   * puis Zoé attendent.
   */
  async function onePlaceAndTwoWaiting() {
    await capacity(PAID, 11);
    const lea = await login(app, 'lea@example.com');
    const marc = await login(app, 'marc@example.com');
    const zoe = await login(app, 'zoe@example.com');
    const holding = await register(PAID, lea, 'Les Aigles d’Annecy');
    const first = await register(PAID, marc, 'Marmottes de Megève');
    const second = await register(PAID, zoe, 'Zébulons du Fayet');
    expect(holding.status).toBe('PENDING_PAYMENT');
    expect(first.status).toBe('WAITLISTED');
    expect(second.status).toBe('WAITLISTED');
    await inOrder(holding.orderId, first.orderId, second.orderId);
    return { lea, marc, zoe, holding, first, second };
  }

  it('propose la place rendue à la première équipe en attente, 48 heures, qui paie et est inscrite', async () => {
    const { lea, marc, zoe, holding, first, second } =
      await onePlaceAndTwoWaiting();
    expect((await view(second.orderId, zoe)).waitlistPosition).toBe(2);

    // La page de paiement de Léa expire : sa place va à Marc.
    expect((await expireSession('cs_test_1')).statusCode).toBe(200);
    expect(await view(holding.orderId, lea)).toMatchObject({
      status: 'EXPIRED',
    });
    const offered = await view(first.orderId, marc);
    expect(offered).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT.toISOString(),
    });
    // Rien n'est encaissé ni demandé à Stripe avant que Marc ne clique.
    expect(offered.checkoutUrl).toBeUndefined();
    expect(offered.expiresAt).toBeUndefined();
    expect(stripe.sessions).toHaveLength(1);
    expect(await view(second.orderId, zoe)).toMatchObject({
      status: 'WAITLISTED',
      waitlistPosition: 1,
    });
    // La place proposée compte : le tournoi reste complet.
    expect((await invite(PAID)).full).toBe(true);
    const mail = mailbox.findLast((m) => m.to === 'marc@example.com');
    expect(mail?.subject).toBe(
      'Une place s’est libérée pour Marmottes de Megève au Tournoi du 11-Novembre U15',
    );
    expect(mail?.text).toContain('128,90');
    expect(mail?.text).toContain('/my-teams');

    // Marc paie : page Stripe de 31 minutes, la place reste tenue jusqu'à l'échéance.
    const checkout = await action(first.orderId, marc, 'checkout');
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json()).toMatchObject({
      status: 'PENDING_PAYMENT',
      checkoutUrl: 'https://checkout.stripe.test/cs_test_2',
      expiresAt: HOLD_END.toISOString(),
      paymentDueAt: DUE_AT.toISOString(),
    });
    expect(stripe.sessions[1]?.expiresAt).toEqual(HOLD_END);
    await webhook('checkout.session.completed', {
      id: 'cs_test_2',
      payment_status: 'paid',
      payment_intent: 'pi_2',
      amount_total: 12890,
      currency: 'eur',
      livemode: false,
    });
    expect(await row(first.orderId)).toMatchObject({
      status: 'CONFIRMED',
      paymentDueAt: null,
      paymentIntentId: 'pi_2',
    });
    expect(
      (await prisma.tournament.findUniqueOrThrow({ where: { slug: PAID } }))
        .teamCount,
    ).toBe(11);
    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(await view(second.orderId, zoe)).toMatchObject({
      status: 'WAITLISTED',
      waitlistPosition: 1,
    });
  });

  it('ferme la page de paiement d’une place proposée sans rendre la place', async () => {
    const { marc, zoe, first, second } = await onePlaceAndTwoWaiting();
    await expireSession('cs_test_1');
    await action(first.orderId, marc, 'checkout');
    expect((await expireSession('cs_test_2')).statusCode).toBe(200);
    const still = await view(first.orderId, marc);
    expect(still).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT.toISOString(),
    });
    expect(still.checkoutUrl).toBeUndefined();
    expect(await view(second.orderId, zoe)).toMatchObject({
      status: 'WAITLISTED',
    });
    // Et se rouvre tant que l'échéance n'est pas passée.
    expect(
      (await action(first.orderId, marc, 'checkout')).json(),
    ).toMatchObject({ checkoutUrl: 'https://checkout.stripe.test/cs_test_3' });
  });

  it('fait échoir la place proposée à sa date limite et promeut la suivante', async () => {
    const { marc, zoe, first, second } = await onePlaceAndTwoWaiting();
    await expireSession('cs_test_1');
    // 48 heures plus tard, sans paiement (horloge figée : l'échéance est reculée).
    await prisma.registration.update({
      where: { id: first.orderId },
      data: { paymentDueAt: new Date(DEMO_NOW.getTime() - 60_000) },
    });
    expect(await view(first.orderId, marc)).toMatchObject({
      status: 'EXPIRED',
    });
    expect(await waitlist.sweep()).toBe(1);
    expect(await row(first.orderId)).toMatchObject({ status: 'EXPIRED' });
    expect(await view(second.orderId, zoe)).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT.toISOString(),
    });
    expect(
      mailbox.findLast((m) => m.to === 'zoe@example.com')?.subject,
    ).toContain('Une place s’est libérée pour Zébulons du Fayet');
    // Marc peut reprendre : complet, il repart en liste d'attente.
    expect(
      (await action(first.orderId, marc, 'checkout')).json(),
    ).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 });
    expect((await row(first.orderId)).paymentDueAt).toBeNull();
    // Rien de plus à faire : le balayage est sans effet.
    expect(await waitlist.sweep()).toBe(0);
  });

  it('renoncer : quitte la liste d’attente, ou rend la place proposée à la suivante', async () => {
    const { lea, marc, zoe, holding, first, second } =
      await onePlaceAndTwoWaiting();
    const noa = await login(app, 'noa@example.com');
    const third = await register(PAID, noa, 'Nuages de Passy');
    await inOrder(
      holding.orderId,
      first.orderId,
      second.orderId,
      third.orderId,
    );
    await expireSession('cs_test_1');

    // Zoé quitte la liste : personne n'est promu, Noa avance.
    const left = await action(second.orderId, zoe, 'decline');
    expect(left.statusCode).toBe(200);
    expect(left.json()).toMatchObject({ status: 'CANCELLED' });
    expect(await view(third.orderId, noa)).toMatchObject({
      status: 'WAITLISTED',
      waitlistPosition: 1,
    });
    expect(await row(first.orderId)).toMatchObject({
      status: 'PENDING_PAYMENT',
    });

    // Marc refuse la place : Noa la reçoit aussitôt.
    expect((await action(first.orderId, marc, 'decline')).json()).toMatchObject(
      { status: 'CANCELLED' },
    );
    expect(await view(third.orderId, noa)).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT.toISOString(),
    });
    // Renoncer deux fois est sans effet ; un paiement expiré se renonce aussi.
    expect((await action(first.orderId, marc, 'decline')).statusCode).toBe(200);
    expect(
      (await action(holding.orderId, lea, 'decline')).json(),
    ).toMatchObject({ status: 'CANCELLED' });
    // L'inscription d'un autre compte : introuvable.
    expect((await action(third.orderId, marc, 'decline')).statusCode).toBe(404);

    // Une équipe inscrite se désiste auprès de l'organisateur.
    await prisma.tournament.update({
      where: { slug: FREE },
      data: { feeCents: 0 },
    });
    const confirmed = await register(FREE, lea, 'Les Aigles d’Annecy');
    expect(confirmed.status).toBe('CONFIRMED');
    const refused = await action(confirmed.orderId, lea, 'decline');
    expect(refused.statusCode).toBe(409);
    expect(refused.headers['content-type']).toContain(
      'application/problem+json',
    );
  });

  it('deux places rendues en même temps promeuvent deux équipes distinctes, jamais au-delà de la capacité', async () => {
    await capacity(PAID, 12);
    const tokens = await Promise.all(
      ['lea', 'marc', 'zoe', 'noa', 'eli'].map((who) =>
        login(app, `${who}@example.com`),
      ),
    );
    const a = await register(PAID, tokens[0]!, 'Équipe A');
    const b = await register(PAID, tokens[1]!, 'Équipe B');
    expect([a.status, b.status]).toEqual([
      'PENDING_PAYMENT',
      'PENDING_PAYMENT',
    ]);
    const c = await register(PAID, tokens[2]!, 'Équipe C');
    const d = await register(PAID, tokens[3]!, 'Équipe D');
    const e = await register(PAID, tokens[4]!, 'Équipe E');
    expect([c.status, d.status, e.status]).toEqual([
      'WAITLISTED',
      'WAITLISTED',
      'WAITLISTED',
    ]);
    await inOrder(a.orderId, b.orderId, c.orderId, d.orderId, e.orderId);

    const results = await Promise.all([
      expireSession('cs_test_1'),
      expireSession('cs_test_2'),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await row(c.orderId)).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT,
    });
    expect(await row(d.orderId)).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT,
    });
    expect(await row(e.orderId)).toMatchObject({ status: 'WAITLISTED' });
    expect((await invite(PAID)).full).toBe(true);

    // Deux promotions concurrentes de plus : rien ne bouge.
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: PAID },
    });
    const again = await Promise.all([
      waitlist.promote(tournament.id),
      waitlist.promote(tournament.id),
    ]);
    expect(again).toEqual([[], []]);
    expect(
      await prisma.registration.count({
        where: { tournamentId: tournament.id, status: 'PENDING_PAYMENT' },
      }),
    ).toBe(2);
    expect(await row(e.orderId)).toMatchObject({ status: 'WAITLISTED' });
    expect(
      mailbox.filter((m) => m.subject.startsWith('Une place s’est libérée')),
    ).toHaveLength(2);
  });

  it('l’organisateur voit le rang et l’échéance, promeut à la main (Idempotency-Key), 404 hors du club', async () => {
    await capacity(PAID, 10);
    const lea = await login(app, 'lea@example.com');
    const marc = await login(app, 'marc@example.com');
    const first = await register(PAID, lea, 'Les Aigles d’Annecy');
    const second = await register(PAID, marc, 'Marmottes de Megève');
    await inOrder(first.orderId, second.orderId);
    const owner = await login(app, 'multi@example.org');
    const list = () =>
      app.inject({
        method: 'GET',
        url: `/api/v1/organizer/tournaments/${PAID}/registrations`,
        headers: { ...auth(owner), ...CLUB },
      });
    expect((await list()).json().items).toEqual([
      expect.objectContaining({
        id: first.orderId,
        status: 'WAITLISTED',
        waitlistPosition: 1,
      }),
      expect.objectContaining({
        id: second.orderId,
        status: 'WAITLISTED',
        waitlistPosition: 2,
      }),
    ]);

    const promote = (id: string, key: string, headers = CLUB, slug = PAID) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/organizer/tournaments/${slug}/registrations/${id}/promote`,
        headers: { ...auth(owner), ...headers, 'idempotency-key': key },
      });
    // Complet : rien à proposer.
    const full = await promote(second.orderId, 'promo-full-0001');
    expect(full.statusCode).toBe(409);
    expect(full.json().detail).toContain('complet');

    // Le club agrandit le tournoi et promeut Marc avant Léa.
    await capacity(PAID, 11);
    const promoted = await promote(second.orderId, 'promo-marc-0001');
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json()).toMatchObject({
      id: second.orderId,
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT.toISOString(),
    });
    expect(promoted.json().waitlistPosition).toBeUndefined();
    const replayed = await promote(second.orderId, 'promo-marc-0001');
    expect(replayed.statusCode).toBe(200);
    expect(replayed.headers['idempotent-replayed']).toBe('true');
    expect(replayed.json()).toEqual(promoted.json());
    // Plus de place pour Léa ; une inscription déjà promue : 409.
    expect((await promote(first.orderId, 'promo-lea-00001')).statusCode).toBe(
      409,
    );
    expect((await promote(second.orderId, 'promo-marc-0002')).statusCode).toBe(
      409,
    );
    expect((await list()).json().items).toEqual([
      expect.objectContaining({ id: first.orderId, waitlistPosition: 1 }),
      expect.objectContaining({
        id: second.orderId,
        status: 'PENDING_PAYMENT',
        paymentDueAt: DUE_AT.toISOString(),
      }),
    ]);
    expect(
      mailbox.findLast((m) => m.to === 'marc@example.com')?.subject,
    ).toContain('Une place s’est libérée');

    // Hors du club : introuvable, pas interdit.
    const other = await login(app, 'orga@example.org');
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/organizer/tournaments/${PAID}/registrations/${first.orderId}/promote`,
      headers: {
        ...auth(other),
        'x-organization': 'etoile-de-l-arve',
        'idempotency-key': 'promo-other-001',
      },
    });
    expect(foreign.statusCode).toBe(404);
    expect(
      (
        await promote(
          first.orderId,
          'promo-slug-00001',
          CLUB,
          'challenge-u13-arve',
        )
      ).statusCode,
    ).toBe(404);
    expect((await promote('inconnue', 'promo-none-0001')).statusCode).toBe(404);
  });

  it('tournoi gratuit : l’équipe promue est inscrite aussitôt, équipe créée et email envoyé', async () => {
    await prisma.tournament.update({
      where: { slug: FREE },
      data: { feeCents: 0, maxTeams: 6 },
    });
    const lea = await login(app, 'lea@example.com');
    const waiting = await register(FREE, lea, 'Les Aigles d’Annecy');
    expect(waiting.status).toBe('WAITLISTED');

    await capacity(FREE, 7);
    expect(await waitlist.sweep()).toBe(1);
    const confirmed = await row(waiting.orderId);
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      paymentDueAt: null,
    });
    expect(confirmed.teamId).not.toBeNull();
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: FREE },
      include: { teams: { where: { name: 'Les Aigles d’Annecy' } } },
    });
    expect(tournament.teamCount).toBe(7);
    expect(tournament.teams[0]).toMatchObject({ code: 'aiglesan' });
    expect(mailbox.findLast((m) => m.to === 'lea@example.com')?.subject).toBe(
      'Les Aigles d’Annecy est inscrite au Coupe de Noël U11',
    );
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('la suppression du compte qui tenait une place la rend à la liste d’attente', async () => {
    const { lea, marc, first } = await onePlaceAndTwoWaiting();
    const deleted = await app.inject({
      method: 'POST',
      url: '/api/v1/me/delete',
      headers: auth(lea),
      payload: { email: 'lea@example.com' },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await view(first.orderId, marc)).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentDueAt: DUE_AT.toISOString(),
    });
  });

  it('inscriptions fermées : la liste d’attente n’est plus promue', async () => {
    const { marc, first } = await onePlaceAndTwoWaiting();
    await prisma.tournament.update({
      where: { slug: PAID },
      data: { status: 'REGISTRATION_CLOSED' },
    });
    await expireSession('cs_test_1');
    expect(await view(first.orderId, marc)).toMatchObject({
      status: 'WAITLISTED',
    });
  });
});
