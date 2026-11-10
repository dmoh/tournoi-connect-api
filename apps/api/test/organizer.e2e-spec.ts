import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ORGANIZER_TOKEN, createTestApp } from './setup-app.js';

describe('Espace organisateur (e2e)', () => {
  let app: NestFastifyApplication;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    reset = ctx.reset;
  });
  beforeEach(() => reset());
  afterAll(() => app.close());

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object,
    token = ORGANIZER_TOKEN,
  ) =>
    app.inject({
      method,
      url: `/api/v1/organizer${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(payload ? { payload } : {}),
    });

  it('refuse sans jeton ou avec un mauvais jeton', async () => {
    expect(
      (
        await call(
          'GET',
          '/tournaments/challenge-u13-arve/sponsors',
          undefined,
          '',
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await call(
          'GET',
          '/tournaments/challenge-u13-arve/sponsors',
          undefined,
          'x'.repeat(36),
        )
      ).statusCode,
    ).toBe(401);
  });

  it('cache les tournois des autres organisations (404, jamais 403)', async () => {
    expect(
      (await call('GET', '/tournaments/tournoi-11-novembre-u15/sponsors'))
        .statusCode,
    ).toBe(404);
  });

  it('liste packs, sponsors avec leur audience et prospects du club', async () => {
    const res = await call('GET', '/tournaments/challenge-u13-arve/sponsors');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(
      body.packages.map((p: { tier: string; taken: number }) => [
        p.tier,
        p.taken,
      ]),
    ).toEqual([
      ['GOLD', 1],
      ['SILVER', 2],
      ['BRONZE', 2],
      ['FIELD', 2],
    ]);
    const gold = body.sponsors.find((s: { tier: string }) => s.tier === 'GOLD');
    expect(gold.impressions).toBeGreaterThan(0);
    expect(body.prospects.map((p: { name: string }) => p.name)).toEqual([
      'Assurances du Faucigny',
      'Électricité Arve Services',
    ]);
  });

  it('invite un prospect du club et un nouveau sponsor, puis marque un paiement', async () => {
    const list = (
      await call('GET', '/tournaments/challenge-u13-arve/sponsors')
    ).json();
    const prospect = list.prospects[0];

    const invited = await call(
      'POST',
      '/tournaments/challenge-u13-arve/sponsors',
      {
        sponsorId: prospect.id,
        tier: 'BRONZE',
      },
    );
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({
      name: 'Assurances du Faucigny',
      status: 'INVITED',
    });

    const created = await call(
      'POST',
      '/tournaments/challenge-u13-arve/sponsors',
      {
        name: 'Traiteur du Lac',
        email: 'contact@example.org',
        tier: 'BRONZE',
      },
    );
    expect(created.statusCode).toBe(201);

    const paid = await call(
      'PATCH',
      `/tournament-sponsors/${created.json().id}`,
      { status: 'PAID' },
    );
    expect(paid.statusCode).toBe(204);
    const sponsors = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/public/tournaments/challenge-u13-arve/sponsors',
      })
    ).json();
    expect(sponsors.rotation.map((s: { name: string }) => s.name)).toContain(
      'Traiteur du Lac',
    );
  });

  it('refuse un pack épuisé et une demande incohérente', async () => {
    const full = await call(
      'POST',
      '/tournaments/challenge-u13-arve/sponsors',
      { name: 'Un autre', tier: 'GOLD' },
    );
    expect(full.statusCode).toBe(409);
    const noField = await call(
      'POST',
      '/tournaments/challenge-u13-arve/sponsors',
      { name: 'Sans terrain', tier: 'FIELD' },
    );
    expect(noField.statusCode).toBe(400);
    const both = await call(
      'POST',
      '/tournaments/challenge-u13-arve/sponsors',
      { name: 'Double', sponsorId: 'x', tier: 'BRONZE' },
    );
    expect(both.statusCode).toBe(400);
  });

  it('publie une annonce et un sondage, visibles en tête du fil', async () => {
    const announcement = await call(
      'POST',
      '/tournaments/challenge-u13-arve/posts',
      {
        kind: 'announcement',
        title: 'Finale avancée à 15 h 30',
        body: 'La finale commence plus tôt.',
      },
    );
    expect(announcement.statusCode).toBe(201);

    const badPoll = await call(
      'POST',
      '/tournaments/challenge-u13-arve/posts',
      { kind: 'poll', title: 'Sondage', options: ['Seule'] },
    );
    expect(badPoll.statusCode).toBe(400);

    const news = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/public/tournaments/challenge-u13-arve/news',
      })
    ).json();
    expect(news[0].title).toBe('Finale avancée à 15 h 30');
  });
});
