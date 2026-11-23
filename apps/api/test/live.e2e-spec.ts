import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { PUBLIC_CACHE_CONTROL } from '../src/common/public-cache.js';
import { createTestApp, login } from './setup-app.js';

/**
 * Direct : scores sondés par la page publique. Horloge figée au matin du
 * tournoi de démonstration (11:10, deux matchs en cours depuis 11:00).
 */
describe('Direct des scores (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(() => reset());
  afterAll(() => app.close());

  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: `/api/v1/public${url}`, headers });
  const LIVE = '/tournaments/challenge-u13-arve/live';

  it('liste les matchs en cours avec leur score, la minute et le dernier événement', async () => {
    const res = await get(LIVE);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      asOf: '2026-11-09T10:10:00.000Z',
      status: 'IN_PROGRESS',
      matches: [
        {
          id: 'a5',
          status: 'LIVE',
          scoreHome: 1,
          scoreAway: 0,
          minute: 14,
          updatedAt: '2026-11-09T10:09:48.000Z',
        },
        {
          id: 'b5',
          status: 'LIVE',
          scoreHome: 0,
          scoreAway: 1,
          minute: 12,
          updatedAt: '2026-11-09T10:09:30.000Z',
        },
      ],
    });
  });

  it('se met en cache 2 s, porte un ETag et répond 304 à une revalidation', async () => {
    const first = await get(LIVE);
    expect(first.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    const etag = first.headers['etag'] as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

    const same = await get(LIVE, { 'if-none-match': etag });
    expect(same.statusCode).toBe(304);
    expect(same.body).toBe('');
    expect(same.headers['etag']).toBe(etag);
    expect(same.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);

    const weak = await get(LIVE, { 'if-none-match': `W/${etag}` });
    expect(weak.statusCode).toBe(304);

    const other = await get(LIVE, { 'if-none-match': '"ailleurs"' });
    expect(other.statusCode).toBe(200);
    expect(other.headers['etag']).toBe(etag);
  });

  it('change d’ETag dès qu’un score est validé et garde le match fini 30 minutes', async () => {
    const before = (await get(LIVE)).headers['etag'];
    const token = await login(app);
    const link = await app.inject({
      method: 'POST',
      url: '/api/v1/organizer/tournaments/challenge-u13-arve/matches/a5/reporter-link',
      headers: { authorization: `Bearer ${token}` },
    });
    const reporter = link.json<{ token: string }>().token;
    const send = (payload: object) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/reporter/${reporter}/events`,
        payload,
      });
    expect(
      (
        await send({
          clientEventId: 'live-goal-1',
          type: 'GOAL',
          side: 'away',
          minute: 15,
        })
      ).statusCode,
    ).toBe(200);

    const after = await get(LIVE, { 'if-none-match': before as string });
    expect(after.statusCode).toBe(200);
    expect(after.headers['etag']).not.toBe(before);
    expect(after.json().matches[0]).toMatchObject({
      id: 'a5',
      status: 'LIVE',
      scoreHome: 1,
      scoreAway: 1,
      minute: 15,
      updatedAt: expect.any(String),
    });

    await send({ clientEventId: 'live-end-1', type: 'FULL_TIME', minute: 20 });
    const finished = await get(LIVE);
    expect(finished.json().matches[0]).toMatchObject({
      id: 'a5',
      status: 'FINISHED',
      scoreHome: 1,
      scoreAway: 1,
    });
    expect(finished.json().matches[0].minute).toBeUndefined();

    // Fini depuis plus de 30 minutes : sort du direct du tournoi.
    const a5 = await prisma.match.findFirstOrThrow({
      where: { code: 'a5', tournament: { slug: 'challenge-u13-arve' } },
    });
    await prisma.matchEvent.updateMany({
      where: { matchId: a5.id },
      data: { createdAt: new Date('2026-11-09T09:30:00+01:00') },
    });
    expect(
      (await get(LIVE)).json().matches.map((m: { id: string }) => m.id),
    ).toEqual(['b5']);
  });

  it('sert le direct d’un seul match, quel que soit son statut', async () => {
    const live = await get('/tournaments/challenge-u13-arve/matches/a5/live');
    expect(live.statusCode).toBe(200);
    expect(live.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    expect(live.json()).toEqual({
      asOf: '2026-11-09T10:10:00.000Z',
      status: 'IN_PROGRESS',
      match: {
        id: 'a5',
        status: 'LIVE',
        scoreHome: 1,
        scoreAway: 0,
        minute: 14,
        updatedAt: '2026-11-09T10:09:48.000Z',
      },
    });
    const etag = live.headers['etag'] as string;
    expect(
      (
        await get('/tournaments/challenge-u13-arve/matches/a5/live', {
          'if-none-match': etag,
        })
      ).statusCode,
    ).toBe(304);

    const scheduled = await get(
      '/tournaments/challenge-u13-arve/matches/df1/live',
    );
    expect(scheduled.json().match).toEqual({
      id: 'df1',
      status: 'SCHEDULED',
      scoreHome: 0,
      scoreAway: 0,
      updatedAt: null,
    });
    expect(
      (await get('/tournaments/challenge-u13-arve/matches/zz/live')).statusCode,
    ).toBe(404);
  });

  it('répond 404 sans cache pour un tournoi inconnu ou masqué', async () => {
    expect((await get('/tournaments/inconnu/live')).statusCode).toBe(404);

    await prisma.tournament.update({
      where: { slug: 'challenge-u13-arve' },
      data: { hiddenAt: new Date('2026-11-09T10:00:00Z') },
    });
    const hidden = await get(LIVE);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.headers['content-type']).toContain(
      'application/problem+json',
    );
    expect(hidden.headers['cache-control']).toBeUndefined();
    expect(hidden.headers['etag']).toBeUndefined();
    expect(
      (await get('/tournaments/challenge-u13-arve/matches/a5/live')).statusCode,
    ).toBe(404);
  });
});
