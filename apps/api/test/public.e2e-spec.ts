import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup-app.js';

const CLUSES = 'lat=46.0606&lng=6.5797';

describe('Lectures publiques (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    await ctx.reset();
  });

  afterAll(() => app.close());

  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/v1/public${url}` });

  it('trouve les tournois du rayon, triés par distance', async () => {
    const res = await get(`/tournaments?${CLUSES}&radiusKm=25`);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((t: { slug: string }) => t.slug)).toEqual([
      'challenge-u13-arve',
      'coupe-noel-u11-bonneville',
      'tournoi-11-novembre-u15',
    ]);
    expect(res.json()[0].distanceKm).toBeLessThan(0.1);
  });

  it('filtre par sport et refuse une requête invalide', async () => {
    const basket = await get(
      `/tournaments?${CLUSES}&radiusKm=100&sport=basketball`,
    );
    expect(basket.json().map((t: { slug: string }) => t.slug)).toEqual([
      'basket-3x3-annecy',
    ]);

    const invalid = await get('/tournaments?lat=abc&lng=6');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['content-type']).toContain(
      'application/problem+json',
    );
  });

  it('sert la page publique avec les classements calculés par le moteur', async () => {
    const res = await get('/tournaments/challenge-u13-arve');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.teams).toHaveLength(8);
    expect(body.matches).toHaveLength(15);
    expect(body.matches.find((m: { id: string }) => m.id === 'df1').phase).toBe(
      'semi',
    );
    expect(body.standings[0].rows[0]).toMatchObject({
      teamId: 'eda',
      points: 6,
    });
  });

  it('répond 404 pour un tournoi inconnu', async () => {
    expect((await get('/tournaments/inconnu')).statusCode).toBe(404);
  });

  it('intercale au plus une carte sponsorisée pour quatre éléments, Or en premier', async () => {
    const res = await get('/tournaments/challenge-u13-arve/news');
    const items = res.json() as { type: string; sponsor?: { name: string } }[];
    expect(items.map((i) => i.type)).toEqual([
      'post',
      'post',
      'post',
      'sponsored',
      'post',
      'post',
    ]);
    expect(items[3]?.sponsor?.name).toBe('Fromagerie des Aravis');
  });

  it('expose la bannière Or, le bandeau partagé et les sponsors de terrain', async () => {
    const res = await get('/tournaments/challenge-u13-arve/sponsors');
    const body = res.json();
    expect(body.exclusive.name).toBe('Fromagerie des Aravis');
    expect(body.rotation.map((s: { name: string }) => s.name).sort()).toEqual([
      'Boulangerie des Esserts',
      'Optique du Giffre',
      'Pizzeria La Cordée',
    ]);
    expect(body.fields).toEqual([
      expect.objectContaining({
        field: 'Terrain 1',
        sponsor: expect.objectContaining({ name: 'Garage du Mont-Blanc' }),
      }),
      expect.objectContaining({
        field: 'Terrain 2',
        sponsor: expect.objectContaining({ name: 'Cycles de la Vallée' }),
      }),
    ]);
    // Un sponsor seulement invité n'est jamais affiché.
    expect(JSON.stringify(body)).not.toContain('Menuiserie des Bornes');
    expect(JSON.stringify(body)).not.toContain('email');
  });

  it('compte un vote de sondage', async () => {
    const news = (await get('/tournaments/challenge-u13-arve/news')).json();
    const poll = news.find((i: { kind?: string }) => i.kind === 'poll');
    const option = poll.poll.options[1];
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/posts/${poll.id}/votes`,
      payload: { optionId: option.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().options[1].votes).toBe(option.votes + 1);
  });

  it('cumule les impressions et clics par heure', async () => {
    const sponsors = (
      await get('/tournaments/challenge-u13-arve/sponsors')
    ).json();
    const sponsorId = sponsors.exclusive.id;
    const send = (kind: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/public/audience',
        payload: { sponsorId, placement: 'BANNER_EXCLUSIVE', kind },
      });
    expect((await send('impression')).statusCode).toBe(204);
    await send('impression');
    await send('click');
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/public/audience',
      payload: {
        sponsorId: 'inconnu',
        placement: 'BANNER_EXCLUSIVE',
        kind: 'click',
      },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('sert le fil du direct : buts, carton, arrêt, plus récent en tête', async () => {
    const res = await get('/tournaments/challenge-u13-arve/matches/a5/feed');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events.map((e: { type: string }) => e.type)).toEqual([
      'SAVE',
      'YELLOW_CARD',
      'GOAL',
    ]);
    expect(body.events[2]).toMatchObject({
      side: 'home',
      minute: 3,
      player: 'L. Martin',
      assist: 'N. Dubois',
      score: { home: 1, away: 0 },
    });
    expect(body.reactions).toEqual({ CLAP: 24, FIRE: 9, WOW: 3 });
    expect(body.updatedAt).toBe('2026-11-09T10:09:48.000Z');

    const empty = await get('/tournaments/challenge-u13-arve/matches/df1/feed');
    expect(empty.json()).toEqual({
      events: [],
      reactions: { CLAP: 0, FIRE: 0, WOW: 0 },
      updatedAt: null,
    });
    expect(
      (await get('/tournaments/challenge-u13-arve/matches/zz/feed')).statusCode,
    ).toBe(404);
  });

  it('compte une réaction par appareil et par emoji', async () => {
    const react = (kind: string, deviceId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/public/tournaments/challenge-u13-arve/matches/a5/reactions',
        payload: { kind, deviceId },
      });
    const device = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';
    const first = await react('FIRE', device);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ CLAP: 24, FIRE: 10, WOW: 3 });
    expect((await react('FIRE', device)).json().FIRE).toBe(10);
    expect((await react('BOOM', device)).statusCode).toBe(400);
  });
});
