import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, login, mailbox } from './setup-app.js';

describe('Comptes et connexion (e2e)', () => {
  let app: NestFastifyApplication;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    reset = ctx.reset;
  });
  beforeEach(() => reset());
  afterAll(() => app.close());

  const post = (
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers,
      ...(payload ? { payload } : {}),
    });
  const lastCode = (email: string) =>
    mailbox.findLast((m) => m.to === email)!.subject.slice(0, 6);
  const cookieOf = (res: { headers: Record<string, unknown> }) =>
    String(res.headers['set-cookie']).split(';')[0]!;

  it('crée le compte au premier code et pose une session en cookie HttpOnly', async () => {
    expect(
      (await post('/auth/code', { email: '  Lea.Martin@Example.ORG ' }))
        .statusCode,
    ).toBe(204);
    const message = mailbox.at(-1)!;
    expect(message.to).toBe('lea.martin@example.org');
    expect(message.subject).toMatch(/^\d{6} est votre code Tournoi Connect$/);

    const res = await post('/auth/verify', {
      email: 'lea.martin@example.org',
      code: lastCode('lea.martin@example.org'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      expiresIn: 900,
      user: {
        email: 'lea.martin@example.org',
        needsProfile: true,
        providers: ['EMAIL'],
        memberships: [],
      },
    });
    expect(String(res.headers['set-cookie'])).toMatch(
      /^tc_refresh=[\w-]+; Path=\/api\/v1\/auth; Max-Age=2592000; HttpOnly; SameSite=Strict/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuse un code faux, puis tout code après cinq essais', async () => {
    await post('/auth/code', { email: 'orga@example.org' });
    const good = lastCode('orga@example.org');
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await post('/auth/verify', {
        email: 'orga@example.org',
        code: bad,
      });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
    expect(
      (await post('/auth/verify', { email: 'orga@example.org', code: good }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post('/auth/verify', { email: 'orga@example.org', code: '12345' }))
        .statusCode,
    ).toBe(400);
  });

  it('limite à cinq codes par heure et par adresse', async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        (await post('/auth/code', { email: 'benevole@example.org' }))
          .statusCode,
      ).toBe(204);
    }
    expect(
      (await post('/auth/code', { email: 'benevole@example.org' })).statusCode,
    ).toBe(429);
  });

  it('renouvelle la session une fois, puis la ferme à la déconnexion', async () => {
    await post('/auth/code', { email: 'orga@example.org' });
    const opened = await post('/auth/verify', {
      email: 'orga@example.org',
      code: lastCode('orga@example.org'),
    });
    expect(opened.json().user).toMatchObject({
      firstName: 'Camille',
      needsProfile: false,
      memberships: [
        { organization: { slug: 'etoile-de-l-arve' }, role: 'OWNER' },
      ],
    });
    const first = cookieOf(opened);

    const refreshed = await post('/auth/refresh', undefined, { cookie: first });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toEqual(expect.any(String));
    const second = cookieOf(refreshed);
    expect(second).not.toBe(first);
    // L'ancien jeton a été remplacé : il ne sert plus.
    expect(
      (await post('/auth/refresh', undefined, { cookie: first })).statusCode,
    ).toBe(401);

    const out = await post('/auth/logout', undefined, { cookie: second });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect(
      (await post('/auth/refresh', undefined, { cookie: second })).statusCode,
    ).toBe(401);
    expect((await post('/auth/refresh')).statusCode).toBe(401);
  });

  it('lit et complète le profil avec le jeton d’accès', async () => {
    await post('/auth/code', { email: 'nouveau@example.org' });
    const opened = await post('/auth/verify', {
      email: 'nouveau@example.org',
      code: lastCode('nouveau@example.org'),
    });
    const auth = { authorization: `Bearer ${opened.json().accessToken}` };
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode,
    ).toBe(401);
    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: auth,
      payload: { firstName: ' Zoé ', lastName: 'Morel' },
    });
    expect(updated.json()).toMatchObject({
      firstName: 'Zoé',
      lastName: 'Morel',
      needsProfile: false,
    });
  });

  it('ouvre l’espace organisateur selon le rôle dans le club', async () => {
    const sponsors =
      '/api/v1/organizer/tournaments/challenge-u13-arve/sponsors';
    const link =
      '/api/v1/organizer/tournaments/challenge-u13-arve/matches/a6/reporter-link';
    const as = (token: string, extra: Record<string, string> = {}) => ({
      authorization: `Bearer ${token}`,
      ...extra,
    });

    const owner = await login(app, 'orga@example.org');
    expect(
      (await app.inject({ method: 'GET', url: sponsors, headers: as(owner) }))
        .statusCode,
    ).toBe(200);
    const otherClub = await app.inject({
      method: 'GET',
      url: sponsors,
      headers: as(owner, { 'x-organization': 'racing-du-lac' }),
    });
    expect(otherClub.statusCode).toBe(404);

    const staff = await login(app, 'benevole@example.org');
    expect(
      (await app.inject({ method: 'GET', url: sponsors, headers: as(staff) }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: link, headers: as(staff) }))
        .statusCode,
    ).toBe(201);

    const sponsor = await login(app, 'sponsor@example.org');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: as(sponsor),
    });
    expect(me.json().sponsors).toEqual([
      {
        id: expect.any(String),
        name: 'Fromagerie des Aravis',
        organization: 'etoile-de-l-arve',
      },
    ]);
    expect(
      (await app.inject({ method: 'GET', url: sponsors, headers: as(sponsor) }))
        .statusCode,
    ).toBe(404);

    const admin = await login(app, 'admin@example.org');
    expect(
      (await app.inject({ method: 'GET', url: sponsors, headers: as(admin) }))
        .statusCode,
    ).toBe(200);

    // Deux clubs : le club se choisit par l'en-tête X-Organization.
    const multi = await login(app, 'multi@example.org');
    expect(
      (await app.inject({ method: 'GET', url: sponsors, headers: as(multi) }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: link,
          headers: as(multi, { 'x-organization': 'etoile-de-l-arve' }),
        })
      ).statusCode,
    ).toBe(201);

    const platform = await login(app, 'plateforme@example.org');
    const platformMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: as(platform),
    });
    expect(platformMe.json()).toMatchObject({
      platformAdmin: true,
      memberships: [],
    });
  });

  it('ne propose que les fournisseurs configurés et revient à la connexion sinon', async () => {
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })
      ).json(),
    ).toEqual({ providers: [] });
    const start = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oauth/google/start?returnTo=/organizer',
    });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toBe(
      'http://localhost:4200/login?error=google',
    );
  });
});
