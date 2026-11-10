import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ORGANIZER_TOKEN, createTestApp } from './setup-app.js';

describe('Table de marque du rapporteur (e2e)', () => {
  let app: NestFastifyApplication;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    reset = ctx.reset;
  });
  beforeEach(() => reset());
  afterAll(() => app.close());

  const link = async (match: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/organizer/tournaments/challenge-u13-arve/matches/${match}/reporter-link`,
      headers: { authorization: `Bearer ${ORGANIZER_TOKEN}` },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { token: string; url: string; expiresAt: string };
  };
  const send = (token: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/reporter/${token}/events`,
      payload,
    });

  it('émet un lien de 24 heures qui ouvre le match avec les effectifs', async () => {
    const { token, url, expiresAt } = await link('a6');
    expect(url).toMatch(/\/r\/.+/);
    expect(expiresAt).toBe('2026-11-10T10:10:00.000Z');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reporter/${token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      matchId: 'a6',
      tournamentSlug: 'challenge-u13-arve',
      home: { name: 'Racing du Giffre', shortName: 'RDG' },
      status: 'SCHEDULED',
    });
    expect(res.json().home.players).toHaveLength(8);
    expect(res.json().home.players[0]).toEqual({
      number: 1,
      name: expect.any(String),
    });
  });

  it('refuse un lien invalide et un match hors de l’organisation', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/reporter/a6-demo' }))
        .statusCode,
    ).toBe(404);
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/organizer/tournaments/coupe-noel-u11-bonneville/matches/a1/reporter-link',
      headers: { authorization: `Bearer ${ORGANIZER_TOKEN}` },
    });
    expect(other.statusCode).toBe(404);
  });

  it('compte un but une seule fois, l’annule, puis termine le match', async () => {
    const { token } = await link('a6');
    const goal = {
      clientEventId: 'evt-goal-0001',
      type: 'GOAL',
      side: 'home',
      minute: 4,
      player: 'T. Roux',
    };
    expect((await send(token, goal)).json()).toEqual({
      score: { home: 1, away: 0 },
      status: 'LIVE',
    });
    // Renvoi après une coupure : même clientEventId, pas de second but.
    expect((await send(token, goal)).json().score).toEqual({
      home: 1,
      away: 0,
    });
    await send(token, {
      clientEventId: 'evt-card-0002',
      type: 'YELLOW_CARD',
      side: 'away',
      minute: 6,
      player: 'H. Garcia',
    });
    const cancel = await send(token, {
      clientEventId: 'evt-undo-0003',
      type: 'CANCEL',
      minute: 7,
      cancels: 'evt-goal-0001',
    });
    expect(cancel.json().score).toEqual({ home: 0, away: 0 });
    const end = await send(token, {
      clientEventId: 'evt-end-00004',
      type: 'FULL_TIME',
      minute: 20,
    });
    expect(end.json()).toEqual({
      score: { home: 0, away: 0 },
      status: 'FINISHED',
    });

    const feed = await app.inject({
      method: 'GET',
      url: '/api/v1/public/tournaments/challenge-u13-arve/matches/a6/feed',
    });
    expect(feed.json().events.map((e: { type: string }) => e.type)).toEqual([
      'FULL_TIME',
      'YELLOW_CARD',
    ]);
    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/public/tournaments/challenge-u13-arve',
    });
    expect(
      detail.json().matches.find((m: { id: string }) => m.id === 'a6'),
    ).toMatchObject({
      status: 'FINISHED',
      scoreHome: 0,
      scoreAway: 0,
    });
  });

  it('refuse un but sans équipe', async () => {
    const { token } = await link('a6');
    const res = await send(token, {
      clientEventId: 'evt-goal-0009',
      type: 'GOAL',
      minute: 3,
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});
