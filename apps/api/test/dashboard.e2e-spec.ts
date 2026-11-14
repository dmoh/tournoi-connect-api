import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { STRIPE } from '../src/registrations/registrations.tokens.js';
import { DEMO_NOW, createTestApp, login } from './setup-app.js';

/** Faux Stripe : solde et versements du compte connecté du club. */
class FakeStripe {
  enabled = true;
  balance = vi.fn((account: string) =>
    account === 'acct_panne'
      ? Promise.reject(new Error('Stripe indisponible'))
      : Promise.resolve({
          available: [
            { amount: 12000, currency: 'eur' },
            { amount: 999, currency: 'usd' },
          ],
          pending: [{ amount: 6000, currency: 'eur' }],
        }),
  );
  payouts = vi.fn(() =>
    Promise.resolve({
      data: [
        {
          id: 'po_1',
          amount: 18000,
          currency: 'eur',
          arrival_date: Math.floor(DEMO_NOW.getTime() / 1000),
          status: 'paid',
        },
      ],
    }),
  );
}

const SLUG = 'challenge-u13-arve';

describe('Pilotage du club (e2e)', () => {
  const stripe = new FakeStripe();
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp([{ provide: STRIPE, useValue: stripe }]);
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(() => reset());
  afterAll(() => app.close());

  const as = (token: string) => ({
    authorization: `Bearer ${token}`,
    'x-organization': 'etoile-de-l-arve',
  });

  /** Inscription payée (ou non) d'une équipe sur le tournoi. */
  const registration = async (
    teamName: string,
    status: 'CONFIRMED' | 'WAITLISTED' | 'PENDING_PAYMENT',
  ) => {
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    const manager = await prisma.user.findUniqueOrThrow({
      where: { email: 'orga@example.org' },
    });
    return prisma.registration.create({
      data: {
        tournamentId: tournament.id,
        managerId: manager.id,
        teamName,
        club: 'FC Annecy; section U13',
        managerName: 'Léa Martin',
        phone: '+33 6 12 34 56 78',
        players: [{ firstName: 'Tom', lastName: 'Roux', number: '9' }],
        status,
        feeCents: 6000,
        serviceFeeCents: 470,
        totalCents: 6470,
        idempotencyKey: `${teamName}-${status}`,
        createdAt: DEMO_NOW,
        paidAt: status === 'CONFIRMED' ? DEMO_NOW : null,
        expiresAt:
          status === 'PENDING_PAYMENT'
            ? new Date(DEMO_NOW.getTime() + 10 * 60_000)
            : null,
      },
    });
  };

  it('résume remplissage, encaissements et audience de chaque tournoi', async () => {
    await registration('Les Aigles', 'CONFIRMED');
    await registration('Les Lynx', 'CONFIRMED');
    await registration('Les Ours', 'WAITLISTED');
    await registration('Les Loups', 'PENDING_PAYMENT');
    const sponsor = await prisma.tournamentSponsor.findFirstOrThrow({
      where: { tournament: { slug: SLUG } },
    });
    await prisma.audienceHourly.deleteMany();
    await prisma.audienceHourly.create({
      data: {
        tournamentSponsorId: sponsor.id,
        placement: 'BANNER_ROTATION',
        hourBucket: DEMO_NOW,
        impressions: 120,
        clicks: 9,
      },
    });

    const orga = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/dashboard',
      headers: as(orga),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      tournaments: { slug: string }[];
      totals: object;
      payouts: unknown;
    }>();
    expect(body.tournaments.find((t) => t.slug === SLUG)).toMatchObject({
      status: 'IN_PROGRESS',
      teamCount: 8,
      registrations: { confirmed: 2, pending: 1, waitlisted: 1 },
      collectedCents: 12000,
      serviceFeeCents: 940,
      audience: { impressions: 120, clicks: 9 },
    });
    expect(body.totals).toMatchObject({
      collectedCents: 12000,
      impressions: 120,
      clicks: 9,
    });
    // Paiements non activés : pas de solde Stripe.
    expect(body.payouts).toBeNull();
  });

  it('montre le solde et les versements Stripe du club', async () => {
    await prisma.organization.update({
      where: { slug: 'etoile-de-l-arve' },
      data: { stripeAccountId: 'acct_etoile', stripeChargesEnabled: true },
    });
    const orga = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/dashboard',
      headers: as(orga),
    });
    expect(res.json()).toMatchObject({
      payouts: {
        availableCents: 12000,
        pendingCents: 6000,
        recent: [{ amountCents: 18000, status: 'paid' }],
      },
    });
    expect(stripe.balance).toHaveBeenCalledWith('acct_etoile');

    // Stripe en panne : le tableau de bord répond quand même.
    await prisma.organization.update({
      where: { slug: 'etoile-de-l-arve' },
      data: { stripeAccountId: 'acct_panne' },
    });
    const degraded = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/dashboard',
      headers: as(orga),
    });
    expect(degraded.statusCode).toBe(200);
    expect(degraded.json()).toMatchObject({ payouts: null });
  });

  it('exporte les inscriptions en CSV pour Excel', async () => {
    await registration('=Les Aigles', 'CONFIRMED');
    const orga = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/tournaments/${SLUG}/export/registrations.csv`,
      headers: as(orga),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="inscriptions-${SLUG}.csv"`,
    );
    const lines = res.body.split('\r\n');
    expect(lines[0]).toMatch(/^\uFEFFÉquipe;Club;Responsable;Email;/);
    expect(lines[1]).toBe(
      `'=Les Aigles;"FC Annecy; section U13";Léa Martin;orga@example.org;'+33 6 12 34 56 78;1;Confirmée;60,00;4,70;64,70;09/11/2026 11:10;09/11/2026 11:10`,
    );
  });

  it('exporte les effectifs des équipes', async () => {
    const orga = await login(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/tournaments/${SLUG}/export/players.csv`,
      headers: as(orga),
    });
    expect(res.statusCode).toBe(200);
    const lines = res.body.trimEnd().split('\r\n');
    expect(lines[0]).toBe('\uFEFFÉquipe;Club;Numéro;Nom;Prénom');
    // 8 équipes de 8 joueurs dans les données de démonstration.
    expect(lines).toHaveLength(1 + 64);
  });

  it('réserve le pilotage aux admins du club', async () => {
    const staff = await login(app, 'benevole@example.org');
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/dashboard',
      headers: as(staff),
    });
    expect(denied.statusCode).toBe(404);
    const orga = await login(app);
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/tournaments/tournoi-11-novembre-u15/export/registrations.csv',
      headers: as(orga),
    });
    expect(other.statusCode).toBe(404);
  });
});
