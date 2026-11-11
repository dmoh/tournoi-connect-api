import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import { RATE_LIMITS } from '../src/common/rate-limit.js';
import { createTestApp, login } from './setup-app.js';

/**
 * Vraies limites (facteur 1). Les requêtes arrivent comme par Caddy : de
 * l'adresse locale, l'IP du client dans X-Forwarded-For.
 */
describe('Limites de débit (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const ctx = await createTestApp([], { rateLimitFactor: 1 });
    app = ctx.app;
    await ctx.reset();
  });
  afterAll(() => app.close());

  const viaCaddy = (ip: string) => ({ 'x-forwarded-for': ip });
  const requestCode = (email: string, ip: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/code',
      headers: viaCaddy(ip),
      payload: { email },
    });
  const expectLimited = (res: LightMyRequestResponse, windowMs: number) => {
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      type: 'about:blank',
      title: 'Too Many Requests',
      status: 429,
      detail: expect.stringMatching(/^Trop de requêtes/),
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(windowMs / 1000);
  };

  it('limite les demandes de code par IP, sans bloquer une autre IP', async () => {
    const [{ max, windowMs }] = RATE_LIMITS.authCode;
    for (let i = 0; i < max; i++) {
      expect(
        (await requestCode(`ip-${i}@example.com`, '203.0.113.10')).statusCode,
      ).toBe(204);
    }
    expectLimited(
      await requestCode('ip-de-trop@example.com', '203.0.113.10'),
      windowMs,
    );
    expect(
      (await requestCode('autre-ip@example.com', '203.0.113.11')).statusCode,
    ).toBe(204);
  });

  it('limite les demandes de code par adresse, depuis plusieurs IP', async () => {
    const [, { max, windowMs }] = RATE_LIMITS.authCode;
    for (let i = 0; i < max; i++) {
      expect(
        (await requestCode('cible@example.com', `203.0.113.${100 + i}`))
          .statusCode,
      ).toBe(204);
    }
    // Retry-After distingue cette limite de la limite métier (5 par heure).
    expectLimited(
      await requestCode(' Cible@Example.com ', '203.0.113.150'),
      windowMs,
    );
  });

  it('ignore un X-Forwarded-For forgé par un client qui contourne Caddy', async () => {
    const [{ max, windowMs }] = RATE_LIMITS.authCode;
    const direct = (i: number) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/code',
        remoteAddress: '198.51.100.20',
        headers: viaCaddy(`192.0.2.${i}`),
        payload: { email: `forge-${i}@example.com` },
      });
    for (let i = 0; i < max; i++) {
      expect((await direct(i)).statusCode).toBe(204);
    }
    expectLimited(await direct(max), windowMs);
  });

  it('limite les événements d’audience par IP', async () => {
    const [{ max, windowMs }] = RATE_LIMITS.audience;
    const sponsors = await app.inject({
      method: 'GET',
      url: '/api/v1/public/tournaments/challenge-u13-arve/sponsors',
    });
    const sponsorId = sponsors.json<{ exclusive: { id: string } }>().exclusive
      .id;
    const send = (ip: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/public/audience',
        headers: viaCaddy(ip),
        payload: {
          sponsorId,
          placement: 'BANNER_EXCLUSIVE',
          kind: 'impression',
        },
      });
    for (let i = 0; i < max; i++) {
      expect((await send('203.0.113.20')).statusCode).toBe(204);
    }
    expectLimited(await send('203.0.113.20'), windowMs);
    expect((await send('203.0.113.21')).statusCode).toBe(204);
  });

  it('limite la saisie du rapporteur par lien, pas les autres matchs', async () => {
    const [{ max, windowMs }] = RATE_LIMITS.reporterEvent;
    const organizer = await login(app);
    const link = async (match: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/organizer/tournaments/challenge-u13-arve/matches/${match}/reporter-link`,
          headers: { authorization: `Bearer ${organizer}` },
        })
      ).json<{ token: string }>().token;
    const send = (token: string, i: number) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/reporter/${token}/events`,
        // Même IP pour les deux liens : la limite suit le lien.
        headers: viaCaddy('203.0.113.30'),
        payload: {
          clientEventId: `evt-limite-${String(i).padStart(4, '0')}`,
          type: 'GOAL',
          side: 'home',
          minute: 4,
          player: 'T. Roux',
        },
      });
    const token = await link('a6');
    for (let i = 0; i < max; i++) {
      expect((await send(token, i)).statusCode).toBe(200);
    }
    expectLimited(await send(token, max), windowMs);
    expect((await send(await link('b6'), 0)).statusCode).toBe(200);
  });

  it('limite les inscriptions par compte connecté', async () => {
    const [{ max, windowMs }] = RATE_LIMITS.registration;
    const register = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/tournaments/INCONNU/registrations',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
    const first = await login(app, 'spectateur@example.org');
    for (let i = 0; i < max; i++) {
      expect((await register(first)).statusCode).not.toBe(429);
    }
    expectLimited(await register(first), windowMs);
    // Un jeton invalide n'entame aucun quota : AuthGuard répond 401.
    expect((await register('invalide')).statusCode).toBe(401);
    const second = await login(app, 'benevole@example.org');
    expect((await register(second)).statusCode).not.toBe(429);
  });
});
