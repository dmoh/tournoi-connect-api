import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { signStripePayload } from '../src/payments/stripe-signature.js';
import { CancellationsService } from '../src/registrations/cancellations.service.js';
import { STRIPE } from '../src/registrations/registrations.tokens.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

/** Faux Stripe : sessions et remboursements enregistrés, sans réseau. */
class FakeStripe {
  enabled = true;
  livemode = false;
  sessions: string[] = [];
  createCheckoutSession = vi.fn(() => {
    const id = `cs_cancel_${this.sessions.length + 1}`;
    this.sessions.push(id);
    return Promise.resolve({ id, url: `https://checkout.stripe.test/${id}` });
  });
  createRefund = vi.fn(() =>
    Promise.resolve({ id: 're_cancel', status: 'succeeded' }),
  );
}

const SLUG = 'tournoi-11-novembre-u15';
const CLUB = 'stade-du-mont-blanc';
const OWNER = 'multi@example.org';
const NOW_SECONDS = Math.floor(DEMO_NOW.getTime() / 1000);

describe('Désistement et annulation du tournoi (e2e)', () => {
  const WEBHOOK_SECRET = `whsec_${randomBytes(16).toString('hex')}`;
  const stripe = new FakeStripe();
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let owner: string;

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
    stripe.sessions = [];
    stripe.createRefund.mockClear();
    mailbox.length = 0;
    await prisma.organization.update({
      where: { slug: CLUB },
      data: { stripeAccountId: 'acct_stade', stripeChargesEnabled: true },
    });
    owner = await login(app, OWNER);
  });
  afterAll(async () => {
    delete process.env['STRIPE_WEBHOOK_SECRET'];
    await app.close();
  });

  const key = () => randomBytes(8).toString('hex');
  const register = async (email: string, teamName: string) => {
    const token = await login(app, email);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${SLUG}/registrations`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key() },
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
    return {
      token,
      ...response.json<{ orderId: string; status: string }>(),
    };
  };
  /** Inscrit et paie (128,90 €) : l'équipe est confirmée. */
  const registerPaid = async (email: string, teamName: string) => {
    const registered = await register(email, teamName);
    const session = stripe.sessions.at(-1)!;
    const body = JSON.stringify({
      id: `evt_${randomBytes(8).toString('hex')}`,
      type: 'checkout.session.completed',
      created: NOW_SECONDS,
      livemode: false,
      data: {
        object: {
          id: session,
          payment_status: 'paid',
          payment_intent: `pi_${session}`,
          amount_total: 12890,
          currency: 'eur',
          livemode: false,
        },
      },
    });
    const paid = await app.inject({
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
    expect(paid.statusCode).toBe(200);
    return registered;
  };
  const organizer = (
    url: string,
    payload?: object,
    token = owner,
    club = CLUB,
  ) =>
    app.inject({
      method: payload ? 'POST' : 'GET',
      url: `/api/v1/organizer${url}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization': club,
        ...(payload ? { 'idempotency-key': key() } : {}),
      },
      ...(payload ? { payload } : {}),
    });
  const teamCount = async () =>
    (await prisma.tournament.findUniqueOrThrow({ where: { slug: SLUG } }))
      .teamCount;

  it('désiste une équipe payée et la rembourse ; la place revient à la liste d’attente', async () => {
    await prisma.tournament.update({
      where: { slug: SLUG },
      data: { maxTeams: 11 },
    });
    const lea = await registerPaid('lea@example.com', 'Les Aigles d’Annecy');
    const marc = await register('marc@example.com', 'Marmottes de Megève');
    expect(marc.status).toBe('WAITLISTED');
    expect(await teamCount()).toBe(11);

    const withdrawn = await organizer(
      `/tournaments/${SLUG}/registrations/${lea.orderId}/withdraw`,
      { refund: true },
    );
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toMatchObject({
      drawReset: false,
      registration: {
        status: 'CANCELLED',
        paid: true,
        cancellation: {
          kind: 'WITHDRAWN',
          at: DEMO_NOW.toISOString(),
          refundCents: 12890,
          refundedAt: DEMO_NOW.toISOString(),
        },
      },
    });
    expect(stripe.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntent: 'pi_cs_cancel_1',
        idempotencyKey: `cancel-${lea.orderId}`,
      }),
    );
    expect(await teamCount()).toBe(10);
    expect(
      await prisma.registration.findUniqueOrThrow({
        where: { id: lea.orderId },
      }),
    ).toMatchObject({ teamId: null });
    const mail = mailbox.findLast((m) => m.to === 'lea@example.com');
    expect(mail?.subject).toBe(
      'Inscription de Les Aigles d’Annecy annulée au Tournoi du 11-Novembre U15',
    );
    expect(mail?.text).toContain('128,90');
    // Le responsable lit l'annulation dans Mes équipes.
    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${lea.orderId}`,
      headers: { authorization: `Bearer ${lea.token}` },
    });
    expect(mine.json()).toMatchObject({
      status: 'CANCELLED',
      cancellation: { kind: 'WITHDRAWN', refundCents: 12890 },
    });
    // La place rendue est proposée à Marc (48 h pour payer).
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: marc.orderId },
        })
      ).status,
    ).toBe('PENDING_PAYMENT');

    // Rejouer : déjà close.
    const again = await organizer(
      `/tournaments/${SLUG}/registrations/${lea.orderId}/withdraw`,
      { refund: true },
    );
    expect(again.statusCode).toBe(409);
    expect(stripe.createRefund).toHaveBeenCalledTimes(1);
  });

  it('désiste sans rembourser, et défait un tirage pas encore commencé', async () => {
    const lea = await registerPaid('lea@example.com', 'Les Aigles d’Annecy');
    const team = await prisma.registration.findUniqueOrThrow({
      where: { id: lea.orderId },
      include: { team: true },
    });
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { drawSeed: 'graine' },
    });
    await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        code: 'a1',
        phase: 'groups',
        group: 'A',
        field: 'Terrain 1',
        startsAt: tournament.startsAt,
        homeTeamCode: team.team!.code,
        awayTeamCode: 'autre',
      },
    });

    const withdrawn = await organizer(
      `/tournaments/${SLUG}/registrations/${lea.orderId}/withdraw`,
      { refund: false },
    );
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toMatchObject({
      drawReset: true,
      registration: {
        cancellation: { refundCents: 0, refundedAt: null },
      },
    });
    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(
      await prisma.match.count({ where: { tournamentId: tournament.id } }),
    ).toBe(0);
    expect(
      (await prisma.tournament.findUniqueOrThrow({ where: { slug: SLUG } }))
        .drawSeed,
    ).toBeNull();
    expect(mailbox.findLast((m) => m.to === 'lea@example.com')?.text).toContain(
      'Aucun remboursement',
    );
  });

  it('refuse un désistement une fois les matchs commencés, ou hors du club', async () => {
    const lea = await registerPaid('lea@example.com', 'Les Aigles d’Annecy');
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        code: 'a1',
        phase: 'groups',
        group: 'A',
        field: 'Terrain 1',
        startsAt: tournament.startsAt,
        homeTeamCode: 'x',
        awayTeamCode: 'y',
        status: 'LIVE',
      },
    });
    const url = `/tournaments/${SLUG}/registrations/${lea.orderId}/withdraw`;
    expect((await organizer(url, { refund: true })).statusCode).toBe(409);
    const orga = await login(app, 'orga@example.org');
    expect((await organizer(url, { refund: true }, orga)).statusCode).toBe(404);
    expect(
      (await organizer(url, { refund: true }, orga, 'etoile-de-l-arve'))
        .statusCode,
    ).toBe(404);
    expect((await organizer(url, { refund: 'oui' })).statusCode).toBe(400);
  });

  it('annule le tournoi : tout est remboursé, les responsables prévenus, la page publique l’annonce', async () => {
    await prisma.tournament.update({
      where: { slug: SLUG },
      data: { maxTeams: 11 },
    });
    const lea = await registerPaid('lea@example.com', 'Les Aigles d’Annecy');
    const marc = await register('marc@example.com', 'Marmottes de Megève');

    const preview = await organizer(`/tournaments/${SLUG}/cancellation`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      cancellable: true,
      registrations: 2,
      refunds: { count: 1, totalCents: 12890 },
    });

    expect(
      (await organizer(`/tournaments/${SLUG}/cancel`, { reason: 'Non' }))
        .statusCode,
    ).toBe(400);
    const cancelled = await organizer(`/tournaments/${SLUG}/cancel`, {
      reason: 'Terrains enneigés, aucune date de report possible.',
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      status: 'CANCELLED',
      registrations: 2,
      refunds: { count: 1, totalCents: 12890 },
    });
    expect(stripe.createRefund).toHaveBeenCalledTimes(1);
    for (const id of [lea.orderId, marc.orderId]) {
      expect(
        await prisma.registration.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({
        status: 'CANCELLED',
        cancellation: 'TOURNAMENT_CANCELLED',
      });
    }
    expect(mailbox.findLast((m) => m.to === 'lea@example.com')?.subject).toBe(
      'Tournoi du 11-Novembre U15 est annulé',
    );
    expect(
      mailbox.findLast((m) => m.to === 'marc@example.com')?.text,
    ).toContain('Vous n’aviez rien payé');

    const page = await app.inject({
      method: 'GET',
      url: `/api/v1/public/tournaments/${SLUG}`,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({
      status: 'CANCELLED',
      cancellation: {
        at: DEMO_NOW.toISOString(),
        reason: 'Terrains enneigés, aucune date de report possible.',
      },
    });
    // Ni nouvelle inscription, ni seconde annulation.
    const late = await app.inject({
      method: 'GET',
      url: `/api/v1/public/registrations/${SLUG}`,
    });
    expect(late.json()).toMatchObject({ open: false });
    expect(
      (
        await organizer(`/tournaments/${SLUG}/cancel`, {
          reason: 'Encore une fois, par erreur.',
        })
      ).statusCode,
    ).toBe(409);
    const list = await organizer('/tournaments');
    expect(
      list
        .json<{ items: { slug: string; status: string }[] }>()
        .items.find((t) => t.slug === SLUG)?.status,
    ).toBe('CANCELLED');
  });

  it('seul le propriétaire annule ; un tournoi terminé ne s’annule plus', async () => {
    const admin = await login(app, 'admin@example.org');
    expect(
      (
        await organizer(
          '/tournaments/challenge-u13-arve/cancel',
          { reason: 'Gymnase indisponible ce jour-là.' },
          admin,
          'etoile-de-l-arve',
        )
      ).statusCode,
    ).toBe(404);
    await prisma.tournament.update({
      where: { slug: SLUG },
      data: { status: 'COMPLETED' },
    });
    expect(
      (
        await organizer(`/tournaments/${SLUG}/cancel`, {
          reason: 'Gymnase indisponible ce jour-là.',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await organizer(`/tournaments/${SLUG}/cancellation`)).json(),
    ).toMatchObject({ cancellable: false });
  });

  it('le rattrapage du worker repasse les remboursements en échec', async () => {
    const lea = await registerPaid('lea@example.com', 'Les Aigles d’Annecy');
    stripe.createRefund.mockRejectedValueOnce(new Error('Stripe indisponible'));
    const withdrawn = await organizer(
      `/tournaments/${SLUG}/registrations/${lea.orderId}/withdraw`,
      { refund: true },
    );
    // Sans Redis, le remboursement est tenté tout de suite ; son échec attend le rattrapage.
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().registration.cancellation.refundedAt).toBeNull();
    await prisma.registration.update({
      where: { id: lea.orderId },
      data: { cancelledAt: new Date(DEMO_NOW.getTime() - 20 * 60_000) },
    });
    expect(await app.get(CancellationsService).sweep()).toBe(1);
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: lea.orderId },
        })
      ).refundedAt,
    ).toEqual(DEMO_NOW);
  });
});
