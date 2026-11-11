import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import {
  createTestApp,
  DEMO_NOW,
  login,
  ORGANIZER_EMAIL,
} from './setup-app.js';

const HOUR = 60 * 60 * 1000;
const TOURNAMENT = '/tournaments/challenge-u13-arve';

describe('Idempotency-Key des écritures organisateur (e2e)', () => {
  let app: NestFastifyApplication;
  let reset: () => Promise<void>;
  let prisma: PrismaService;
  let token = '';

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    reset = ctx.reset;
    prisma = ctx.prisma;
  });
  beforeEach(async () => {
    await reset();
    token = await login(app);
  });
  afterAll(() => app.close());

  const post = (url: string, payload: object, key?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/organizer${url}`,
      headers: {
        authorization: `Bearer ${token}`,
        // Casse de la PWA (core/http/idempotency.ts).
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      payload,
    });

  const draft = {
    name: 'Tournoi de la Clé',
    sport: 'football',
    date: '2026-12-05',
    startTime: '09:00',
    endTime: '17:30',
    venueName: 'Stade des Esserts',
    city: 'Cluses',
    lat: 46.0606,
    lng: 6.5797,
    fields: 3,
    outdoor: true,
    categories: ['U13'],
    maxTeams: 16,
    feeEuros: 60,
    format: 'groups-knockout',
    matchMinutes: 12,
    breakMinutes: 3,
    registrationDeadline: '2026-11-28',
  };
  const tournaments = (name = draft.name) =>
    prisma.tournament.count({ where: { name } });

  describe('publier un tournoi', () => {
    it('rejoue la même réponse pour la même clé, sans second tournoi', async () => {
      const key = randomUUID();
      const first = await post('/tournaments', draft, key);
      expect(first.statusCode).toBe(201);
      expect(first.json().slug).toBe('tournoi-de-la-cle');

      const again = await post('/tournaments', draft, key);
      expect(again.statusCode).toBe(201);
      expect(again.json()).toEqual(first.json());
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(await tournaments()).toBe(1);
    });

    it('ne crée qu’un tournoi pour deux envois simultanés de la même clé', async () => {
      const key = randomUUID();
      const results = await Promise.all([
        post('/tournaments', draft, key),
        post('/tournaments', draft, key),
      ]);
      const statuses = results.map((r) => r.statusCode).sort((a, b) => a - b);
      expect([
        [201, 201],
        [201, 409],
      ]).toContainEqual(statuses);
      const created = results.filter((r) => r.statusCode === 201);
      expect(new Set(created.map((r) => r.json().slug)).size).toBe(1);
      const conflict = results.find((r) => r.statusCode === 409);
      if (conflict) {
        expect(conflict.headers['content-type']).toContain(
          'application/problem+json',
        );
        expect(conflict.json().detail).toMatch(/en cours/);
      }
      expect(await tournaments()).toBe(1);
    });

    it('refuse la même clé sur un autre corps (422)', async () => {
      const key = randomUUID();
      expect((await post('/tournaments', draft, key)).statusCode).toBe(201);
      const other = await post(
        '/tournaments',
        { ...draft, name: 'Autre tournoi' },
        key,
      );
      expect(other.statusCode).toBe(422);
      expect(other.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(await tournaments('Autre tournoi')).toBe(0);
    });

    it('garde le comportement actuel sans clé et refuse une clé mal formée', async () => {
      expect((await post('/tournaments', draft)).json().slug).toBe(
        'tournoi-de-la-cle',
      );
      expect((await post('/tournaments', draft)).json().slug).toBe(
        'tournoi-de-la-cle-2',
      );
      expect(await tournaments()).toBe(2);

      const bad = await post('/tournaments', draft, 'court');
      expect(bad.statusCode).toBe(400);
      expect(await tournaments()).toBe(2);
    });

    it('libère la clé d’une requête refusée : le renvoi est rejoué à neuf', async () => {
      const key = randomUUID();
      const invalid = {
        ...draft,
        feeEuros: 5,
        registrationDeadline: '2026-12-10',
      };
      expect((await post('/tournaments', invalid, key)).statusCode).toBe(400);
      expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
      expect((await post('/tournaments', invalid, key)).statusCode).toBe(400);
    });

    it('donne des slugs distincts à des tournois de même nom créés en même temps', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => post('/tournaments', draft)),
      );
      expect(results.map((r) => r.statusCode)).toEqual([
        201, 201, 201, 201, 201,
      ]);
      expect(new Set(results.map((r) => r.json().slug))).toEqual(
        new Set([
          'tournoi-de-la-cle',
          'tournoi-de-la-cle-2',
          'tournoi-de-la-cle-3',
          'tournoi-de-la-cle-4',
          'tournoi-de-la-cle-5',
        ]),
      );
      expect(await tournaments()).toBe(5);
    });
  });

  describe('inviter un sponsor', () => {
    const sponsor = { name: 'Traiteur du Lac', tier: 'BRONZE' };
    const rows = () =>
      prisma.tournamentSponsor.count({
        where: { sponsor: { name: sponsor.name } },
      });

    it('rejoue l’invitation pour la même clé', async () => {
      const key = randomUUID();
      const first = await post(`${TOURNAMENT}/sponsors`, sponsor, key);
      expect(first.statusCode).toBe(201);
      const again = await post(`${TOURNAMENT}/sponsors`, sponsor, key);
      expect(again.statusCode).toBe(201);
      expect(again.json()).toEqual(first.json());
      expect(await rows()).toBe(1);
    });

    it('n’invite qu’une fois pour deux envois simultanés', async () => {
      const key = randomUUID();
      const results = await Promise.all([
        post(`${TOURNAMENT}/sponsors`, sponsor, key),
        post(`${TOURNAMENT}/sponsors`, sponsor, key),
      ]);
      expect([
        [201, 201],
        [201, 409],
      ]).toContainEqual(results.map((r) => r.statusCode).sort((a, b) => a - b));
      expect(await rows()).toBe(1);
    });

    it('refuse la même clé pour un autre sponsor, et rejoue un refus métier à neuf', async () => {
      const key = randomUUID();
      expect(
        (await post(`${TOURNAMENT}/sponsors`, sponsor, key)).statusCode,
      ).toBe(201);
      expect(
        (
          await post(
            `${TOURNAMENT}/sponsors`,
            { ...sponsor, name: 'Autre sponsor' },
            key,
          )
        ).statusCode,
      ).toBe(422);

      // Pack Or épuisé : 409 métier, la clé n'est pas gardée.
      const full = randomUUID();
      const gold = { name: 'Un autre', tier: 'GOLD' };
      const refused = await post(`${TOURNAMENT}/sponsors`, gold, full);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().detail).toBe('Ce pack est épuisé.');
      const retried = await post(`${TOURNAMENT}/sponsors`, gold, full);
      expect(retried.json().detail).toBe('Ce pack est épuisé.');
    });

    it('invite deux fois sans clé : le second est refusé comme avant', async () => {
      expect((await post(`${TOURNAMENT}/sponsors`, sponsor)).statusCode).toBe(
        201,
      );
      // Nouveau sponsor du même nom : une seconde ligne, comme aujourd'hui.
      expect((await post(`${TOURNAMENT}/sponsors`, sponsor)).statusCode).toBe(
        201,
      );
      expect(await rows()).toBe(2);
    });
  });

  describe('publier une annonce', () => {
    const announcement = {
      kind: 'announcement',
      title: 'Buvette ouverte',
      body: 'Crêpes et boissons chaudes.',
    };
    const posts = () =>
      prisma.post.count({ where: { title: announcement.title } });

    it('rejoue l’annonce pour la même clé', async () => {
      const key = randomUUID();
      const first = await post(`${TOURNAMENT}/posts`, announcement, key);
      expect(first.statusCode).toBe(201);
      const again = await post(`${TOURNAMENT}/posts`, announcement, key);
      expect(again.statusCode).toBe(201);
      expect(again.json()).toEqual(first.json());
      expect(await posts()).toBe(1);
    });

    it('ne publie qu’une fois pour deux envois simultanés', async () => {
      const key = randomUUID();
      const results = await Promise.all([
        post(`${TOURNAMENT}/posts`, announcement, key),
        post(`${TOURNAMENT}/posts`, announcement, key),
      ]);
      expect([
        [201, 201],
        [201, 409],
      ]).toContainEqual(results.map((r) => r.statusCode).sort((a, b) => a - b));
      expect(await posts()).toBe(1);
    });

    it('refuse la même clé sur un autre corps, publie deux fois sans clé', async () => {
      const key = randomUUID();
      expect(
        (await post(`${TOURNAMENT}/posts`, announcement, key)).statusCode,
      ).toBe(201);
      expect(
        (
          await post(
            `${TOURNAMENT}/posts`,
            { ...announcement, body: 'Autre texte.' },
            key,
          )
        ).statusCode,
      ).toBe(422);
      expect((await post(`${TOURNAMENT}/posts`, announcement)).statusCode).toBe(
        201,
      );
      expect((await post(`${TOURNAMENT}/posts`, announcement)).statusCode).toBe(
        201,
      );
      expect(await posts()).toBe(3);
    });

    it('sépare les clés par route : la même clé ailleurs s’exécute', async () => {
      const key = randomUUID();
      expect(
        (await post(`${TOURNAMENT}/posts`, announcement, key)).statusCode,
      ).toBe(201);
      const tournament = await post('/tournaments', draft, key);
      expect(tournament.statusCode).toBe(201);
      expect(tournament.json().slug).toBe('tournoi-de-la-cle');
    });
  });

  it('purge les clés de plus de 24 heures', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ORGANIZER_EMAIL },
    });
    const ago = (hours: number) => new Date(DEMO_NOW.getTime() - hours * HOUR);
    const row = (key: string, hours: number) => ({
      userId: user.id,
      scope: 'etoile-de-l-arve POST /api/v1/organizer/tournaments',
      key,
      fingerprint: 'f',
      status: 201,
      response: {},
      createdAt: ago(hours),
    });
    await prisma.idempotencyKey.createMany({
      data: [row('old-key-25h', 25), row('new-key-23h', 23)],
    });

    const report = await app.get(MaintenanceService).purge();
    expect(report.idempotencyKeys).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.idempotencyKey.count({ where: { key: 'old-key-25h' } }),
    ).toBe(0);
    expect(
      await prisma.idempotencyKey.count({ where: { key: 'new-key-23h' } }),
    ).toBe(1);
  });

  it('ne rejoue plus une clé expirée, même pas encore purgée', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: ORGANIZER_EMAIL },
    });
    const organization = await prisma.membership.findFirstOrThrow({
      where: { userId: user.id },
      include: { organization: true },
    });
    await prisma.idempotencyKey.create({
      data: {
        userId: user.id,
        scope: `${organization.organization.slug} POST /api/v1/organizer/tournaments`,
        key: 'expired-key-1',
        fingerprint: 'autre-corps',
        status: 201,
        response: { slug: 'ancien' },
        createdAt: new Date(DEMO_NOW.getTime() - 25 * HOUR),
      },
    });
    const res = await post('/tournaments', draft, 'expired-key-1');
    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe('tournoi-de-la-cle');
  });
});
