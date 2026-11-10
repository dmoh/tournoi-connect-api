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

  const draft = {
    name: 'Coupe d’hiver U13',
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
    registrationDeadline: '2026-11-30',
    format: 'groups-knockout',
    matchMinutes: 10,
    breakMinutes: 10,
  };

  it('liste les tournois de l’organisation seulement', async () => {
    const res = await call('GET', '/tournaments');
    expect(res.statusCode).toBe(200);
    const slugs = res.json().map((t: { slug: string }) => t.slug);
    expect(slugs).toContain('challenge-u13-arve');
    expect(slugs).not.toContain('tournoi-11-novembre-u15');
    expect(res.json()[0]).toMatchObject({
      venueName: expect.any(String),
      fields: 1,
    });
  });

  it('publie le tournoi de l’assistant, visible dans la découverte', async () => {
    const res = await call('POST', '/tournaments', draft);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      slug: 'coupe-d-hiver-u13',
      status: 'PUBLISHED',
      // 9 h à Paris en hiver.
      startsAt: '2026-12-05T08:00:00.000Z',
      venueName: 'Stade des Esserts',
      fields: 3,
    });

    // Même nom : slug suivant ; le lieu est repris, pas dupliqué.
    const again = await call('POST', '/tournaments', draft);
    expect(again.json().slug).toBe('coupe-d-hiver-u13-2');

    const nearby = await app.inject({
      method: 'GET',
      url: '/api/v1/public/tournaments?lat=46.06&lng=6.58&radiusKm=5',
    });
    expect(nearby.json().map((t: { slug: string }) => t.slug)).toContain(
      'coupe-d-hiver-u13',
    );
  });

  it('refuse un brouillon incohérent en problem+json', async () => {
    const res = await call('POST', '/tournaments', {
      ...draft,
      feeEuros: 5,
      registrationDeadline: '2026-12-10',
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('refuse la création sans jeton', async () => {
    expect((await call('POST', '/tournaments', draft, '')).statusCode).toBe(
      401,
    );
  });
});
