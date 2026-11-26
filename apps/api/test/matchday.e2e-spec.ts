import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login } from './setup-app.js';

/** Tournoi en cours le jour figé des tests (DEMO_NOW : 9 nov., 11 h 10). */
const SLUG = 'challenge-u13-arve';
const CLUB = 'etoile-de-l-arve';

describe('Jour J : arrivées et forfaits (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let owner: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    owner = await login(app);
  });
  afterAll(() => app.close());

  const organizer = (
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    payload?: object,
    as = owner,
  ) =>
    app.inject({
      method,
      url: `/api/v1/organizer/tournaments/${SLUG}${url}`,
      headers: {
        authorization: `Bearer ${as}`,
        'x-organization': CLUB,
        ...(method === 'POST'
          ? { 'idempotency-key': randomBytes(8).toString('hex') }
          : {}),
      },
      ...(payload ? { payload } : {}),
    });

  /** Inscription confirmée de l'équipe « eda », comme après un paiement. */
  async function confirmedRegistration() {
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    const team = await prisma.team.findFirstOrThrow({
      where: { tournamentId: tournament.id, code: 'eda' },
    });
    const manager = await prisma.user.findFirstOrThrow({
      where: { email: 'orga@example.org' },
    });
    return prisma.registration.create({
      data: {
        tournamentId: tournament.id,
        managerId: manager.id,
        teamName: team.name,
        club: team.club,
        managerName: 'Camille',
        phone: '0612345678',
        players: [],
        status: 'CONFIRMED',
        feeCents: 0,
        serviceFeeCents: 0,
        totalCents: 0,
        idempotencyKey: randomBytes(8).toString('hex'),
        teamId: team.id,
      },
    });
  }

  it('le responsable signale son arrivée en un appui, par son lien personnel', async () => {
    const registration = await confirmedRegistration();
    const url = `/api/v1/public/arrivals/${registration.arrivalToken}`;

    const before = await app.inject({ method: 'GET', url });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      team: "Étoile de l'Arve",
      tournament: { slug: SLUG },
      arrivedAt: null,
      open: true,
    });
    const arrived = await app.inject({ method: 'POST', url });
    expect(arrived.statusCode).toBe(200);
    expect(arrived.json().arrivedAt).not.toBeNull();
    // Rejouer ne change pas l'heure.
    expect((await app.inject({ method: 'POST', url })).json().arrivedAt).toBe(
      arrived.json().arrivedAt,
    );

    // La régie le voit ; Mes équipes aussi.
    const day = await organizer('GET', '/matchday');
    expect(
      day.json().teams.find((t: { code: string }) => t.code === 'eda'),
    ).toMatchObject({
      arrivedAt: arrived.json().arrivedAt,
      played: true,
      forfeit: false,
    });
    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${registration.id}`,
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(mine.json()).toMatchObject({
      arrival: { token: registration.arrivalToken, open: true },
    });

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/public/arrivals/inconnu',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('refuse l’arrivée avant le jour J', async () => {
    const registration = await confirmedRegistration();
    await prisma.tournament.update({
      where: { slug: SLUG },
      data: {
        startsAt: new Date('2026-11-20T09:00:00+01:00'),
        endsAt: new Date('2026-11-20T17:00:00+01:00'),
      },
    });
    const url = `/api/v1/public/arrivals/${registration.arrivalToken}`;
    expect((await app.inject({ method: 'GET', url })).json().open).toBe(false);
    expect((await app.inject({ method: 'POST', url })).statusCode).toBe(409);
  });

  it('le bénévole pointe une arrivée en un appui, et peut la retirer', async () => {
    const staff = await login(app, 'benevole@example.org');
    const set = await organizer(
      'PUT',
      '/teams/rdg/arrival',
      { arrived: true },
      staff,
    );
    expect(set.statusCode).toBe(200);
    expect(
      set.json().teams.find((t: { code: string }) => t.code === 'rdg')
        .arrivedAt,
    ).not.toBeNull();
    const unset = await organizer(
      'PUT',
      '/teams/rdg/arrival',
      { arrived: false },
      staff,
    );
    // Pointage retiré : rdg reste arrivée, puisqu'elle a déjà joué (début de son premier match).
    const rdg = unset
      .json()
      .teams.find((t: { code: string }) => t.code === 'rdg');
    expect(rdg.played).toBe(true);
    expect(rdg.arrivedAt).not.toBe(
      set.json().teams.find((t: { code: string }) => t.code === 'rdg')
        .arrivedAt,
    );
    expect(
      (await organizer('PUT', '/teams/inconnue/arrival', { arrived: true }))
        .statusCode,
    ).toBe(404);
  });

  it('un forfait donne les matchs restants à l’adversaire, 3-0 au football', async () => {
    // Tournoi tiré au sort pour le test (club Stade du Mont-Blanc).
    const other = 'tournoi-11-novembre-u15';
    const multi = await login(app, 'multi@example.org');
    const club = (method: 'POST' | 'GET', url: string, as = multi) =>
      app.inject({
        method,
        url: `/api/v1/organizer/tournaments/${other}${url}`,
        headers: {
          authorization: `Bearer ${as}`,
          'x-organization': 'stade-du-mont-blanc',
          ...(method === 'POST'
            ? { 'idempotency-key': randomBytes(8).toString('hex') }
            : {}),
        },
        ...(method === 'POST' ? { payload: {} } : {}),
      });
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: other },
    });
    // Quatre équipes inscrites, puis le tirage (une poule, phase finale).
    await prisma.team.createMany({
      data: ['ai', 'bi', 'ca', 'do'].map((code) => ({
        tournamentId: tournament.id,
        code,
        name: `Équipe ${code}`,
        shortName: code.toUpperCase(),
        club: 'Club',
      })),
    });
    expect((await club('POST', '/draw')).statusCode).toBe(200);
    const [team] = await prisma.team.findMany({
      where: { tournamentId: tournament.id },
      orderBy: { code: 'asc' },
      take: 1,
    });
    const code = team!.code;
    const pending = await prisma.match.findMany({
      where: {
        tournamentId: tournament.id,
        status: 'SCHEDULED',
        awayTeamCode: { not: null },
        homeTeamCode: { not: null },
        OR: [{ homeTeamCode: code }, { awayTeamCode: code }],
      },
    });
    expect(pending.length).toBeGreaterThan(0);

    const forfeit = await club('POST', `/teams/${code}/forfeit`);
    expect(forfeit.statusCode).toBe(200);
    expect(forfeit.json().matches).toBeGreaterThanOrEqual(pending.length);
    for (const m of pending) {
      const after = await prisma.match.findUniqueOrThrow({
        where: { id: m.id },
      });
      const home = m.homeTeamCode === code;
      expect(after).toMatchObject({
        status: 'FINISHED',
        forfeit: home ? 'HOME' : 'AWAY',
        scoreHome: home ? 0 : 3,
        scoreAway: home ? 3 : 0,
      });
    }
    expect((await club('POST', `/teams/${code}/forfeit`)).statusCode).toBe(409);

    const page = await app.inject({
      method: 'GET',
      url: `/api/v1/public/tournaments/${other}`,
    });
    const detail = page.json<{
      teams: { id: string; forfeit?: boolean }[];
      matches: { id: string; forfeit?: string }[];
    }>();
    expect(detail.teams.find((t) => t.id === code)?.forfeit).toBe(true);
    expect(
      detail.matches.filter((m) => m.forfeit).length,
    ).toBeGreaterThanOrEqual(pending.length);
  });

  it('seul un admin déclare un forfait', async () => {
    const staff = await login(app, 'benevole@example.org');
    expect(
      (await organizer('POST', '/teams/eda/forfeit', undefined, staff))
        .statusCode,
    ).toBe(404);
  });
});
