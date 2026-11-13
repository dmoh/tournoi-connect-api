import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login, mailbox } from './setup-app.js';

const SLUG = 'challenge-u13-arve';

describe('Signalements et espace plateforme (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    await prisma.report.deleteMany();
  });
  afterAll(() => app.close());

  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const report = (payload: object, slug = SLUG) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/public/tournaments/${slug}/reports`,
      payload,
    });
  const news = async () =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/public/tournaments/${SLUG}/news`,
      })
    ).json<{ type: string; id?: string; title?: string }[]>();
  const openReports = async (token: string) =>
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/platform/reports',
        headers: as(token),
      })
    ).json<{ id: string; post: { id: string } | null }[]>();

  it('signale une actualité sans compte, puis la modération la masque', async () => {
    const post = (await news()).find((item) => item.type === 'post')!;
    const sent = mailbox.length;
    const created = await report({
      postId: post.id,
      reason: 'PRIVACY',
      details: 'Photo d’un joueur mineur sans accord.',
    });
    expect(created.statusCode).toBe(201);
    // Les admins de la plateforme sont prévenus.
    expect(mailbox.slice(sent)).toContainEqual(
      expect.objectContaining({ to: 'plateforme@example.org' }),
    );

    const admin = await login(app, 'plateforme@example.org');
    const [open] = await openReports(admin);
    expect(open).toMatchObject({
      reason: 'PRIVACY',
      tournament: { slug: SLUG, hidden: false },
      post: { id: post.id, hidden: false },
    });

    const hidden = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/reports/${open!.id}/hide`,
      headers: as(admin),
    });
    expect(hidden.statusCode).toBe(204);
    expect((await news()).some((item) => item.id === post.id)).toBe(false);
    // Le propriétaire du club est prévenu.
    expect(mailbox.at(-1)).toMatchObject({
      to: 'orga@example.org',
      subject: "Contenu masqué par la modération : Étoile de l'Arve",
    });
    expect(await openReports(admin)).toEqual([]);

    // Traité : on ne peut plus le traiter une seconde fois.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/reports/${open!.id}/dismiss`,
      headers: as(admin),
    });
    expect(again.statusCode).toBe(404);
  });

  it('masque la page d’un tournoi partout où elle est publique', async () => {
    await report({ reason: 'ILLEGAL' });
    await report({ reason: 'SPAM' });
    const admin = await login(app, 'plateforme@example.org');
    const reports = await openReports(admin);
    expect(reports).toHaveLength(2);
    await app.inject({
      method: 'POST',
      url: `/api/v1/platform/reports/${reports[0]!.id}/hide`,
      headers: as(admin),
    });
    // Un seul geste clôt tous les signalements du même contenu.
    expect(await openReports(admin)).toEqual([]);

    const page = await app.inject({
      method: 'GET',
      url: `/api/v1/public/tournaments/${SLUG}`,
    });
    expect(page.statusCode).toBe(404);
    const sitemap = await app.inject({
      method: 'GET',
      url: '/api/v1/public/sitemap',
    });
    expect(
      sitemap
        .json<{ tournaments: { slug: string }[] }>()
        .tournaments.map((t) => t.slug),
    ).not.toContain(SLUG);
    expect((await report({ reason: 'OTHER' })).statusCode).toBe(404);
  });

  it('écarte un signalement sans rien masquer', async () => {
    await report({ reason: 'ABUSE', contactEmail: ' Temoin@Example.com ' });
    const admin = await login(app, 'plateforme@example.org');
    const [open] = await openReports(admin);
    const dismissed = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/reports/${open!.id}/dismiss`,
      headers: as(admin),
    });
    expect(dismissed.statusCode).toBe(204);
    const closed = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/reports?status=DISMISSED',
      headers: as(admin),
    });
    expect(closed.json()).toEqual([
      expect.objectContaining({
        status: 'DISMISSED',
        contactEmail: 'temoin@example.com',
      }),
    ]);
    const page = await app.inject({
      method: 'GET',
      url: `/api/v1/public/tournaments/${SLUG}`,
    });
    expect(page.statusCode).toBe(200);
  });

  it('refuse un signalement incomplet, et limite le nombre par heure', async () => {
    expect((await report({ reason: 'NOPE' })).statusCode).toBe(400);
    expect(
      (await report({ reason: 'SPAM', postId: 'inconnu' })).statusCode,
    ).toBe(404);
    expect(
      (await report({ reason: 'SPAM' }, 'tournoi-inexistant')).statusCode,
    ).toBe(404);

    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    await prisma.report.createMany({
      data: Array.from({ length: 30 }, () => ({
        tournamentId: tournament.id,
        reason: 'SPAM' as const,
      })),
    });
    expect((await report({ reason: 'SPAM' })).statusCode).toBe(429);
  });

  it('réserve l’espace plateforme à ses admins (404 sinon)', async () => {
    const orga = await login(app);
    for (const url of [
      '/api/v1/platform/overview',
      '/api/v1/platform/reports',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: as(orga) });
      expect(res.statusCode).toBe(404);
    }
    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/overview',
    });
    expect(anonymous.statusCode).toBe(401);

    await report({ reason: 'SPAM' });
    const admin = await login(app, 'plateforme@example.org');
    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/overview',
      headers: as(admin),
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      counts: {
        clubs: expect.any(Number),
        tournaments: { inProgress: 1 },
        openReports: 1,
      },
      services: {
        mail: false,
        payments: { secretKey: false, webhook: false },
        push: false,
        oauth: [],
      },
    });
  });
});
