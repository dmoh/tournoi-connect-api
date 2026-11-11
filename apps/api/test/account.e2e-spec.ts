import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { MaintenanceService } from '../src/maintenance/maintenance.service.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

const DAY = 24 * 60 * 60 * 1000;

describe('Mes données : export, suppression, purge (e2e)', () => {
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

  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const registerFree = async (token: string) => {
    await prisma.tournament.update({
      where: { slug: 'coupe-noel-u11-bonneville' },
      data: { feeCents: 0 },
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments/coupe-noel-u11-bonneville/registrations',
      headers: {
        ...as(token),
        'idempotency-key': randomBytes(8).toString('hex'),
      },
      payload: {
        teamName: 'Les Aigles d’Annecy',
        club: 'FC Annecy',
        managerName: 'Léa Martin',
        phone: '06 12 34 56 78',
        players: [{ firstName: 'Tom', lastName: 'Roux', number: '9' }],
        acceptRules: true,
      },
    });
    expect(created.json()).toMatchObject({ status: 'CONFIRMED' });
    return created.json<{ orderId: string }>().orderId;
  };
  const remove = (token: string, email: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/me/delete',
      headers: as(token),
      payload: { email },
    });

  it('exporte les données du compte en fichier JSON', async () => {
    const token = await login(app, 'lea@example.com');
    await registerFree(token);
    await app.inject({
      method: 'PUT',
      url: '/api/v1/me/follows',
      headers: as(token),
      payload: { tournaments: ['challenge-u13-arve'], teams: [] },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/export',
      headers: as(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toMatchObject({
      account: { email: 'lea@example.com' },
      identities: [{ provider: 'EMAIL', subject: 'lea@example.com' }],
      registrations: [
        {
          teamName: 'Les Aigles d’Annecy',
          phone: '06 12 34 56 78',
          status: 'CONFIRMED',
        },
      ],
      follows: [{ kind: 'TOURNAMENT', target: 'challenge-u13-arve' }],
    });
    expect(res.json<{ sessions: unknown[] }>().sessions.length).toBeGreaterThan(
      0,
    );

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/me/export',
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('supprime le compte et anonymise ses inscriptions confirmées', async () => {
    const token = await login(app, 'lea@example.com');
    const orderId = await registerFree(token);

    const wrong = await remove(token, 'autre@example.com');
    expect(wrong.statusCode).toBe(400);

    const res = await remove(token, ' Lea@Example.com ');
    expect(res.statusCode).toBe(204);
    expect(res.headers['set-cookie']).toMatch(/tc_refresh=;.*Max-Age=0/);
    expect(mailbox.at(-1)).toMatchObject({
      to: 'lea@example.com',
      subject: 'Votre compte Tournoi Connect est supprimé',
    });

    expect(
      await prisma.user.findUnique({ where: { email: 'lea@example.com' } }),
    ).toBeNull();
    expect(
      await prisma.loginCode.count({ where: { email: 'lea@example.com' } }),
    ).toBe(0);
    const registration = await prisma.registration.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(registration).toMatchObject({
      managerId: null,
      managerName: 'Compte supprimé',
      phone: '',
      status: 'CONFIRMED',
    });
    // L'équipe reste au tournoi.
    expect(registration.teamId).not.toBeNull();

    // Le jeton d'accès encore en mémoire ne rouvre rien.
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/me/export',
      headers: as(token),
    });
    expect(after.statusCode).toBe(404);

    // L'organisateur voit l'inscription sans coordonnées.
    const orga = await login(app);
    const [owner, club] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'orga@example.org' } }),
      prisma.organization.findUniqueOrThrow({
        where: { slug: 'avenir-des-bornes' },
      }),
    ]);
    await prisma.membership.create({
      data: { userId: owner.id, organizationId: club.id, role: 'ADMIN' },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/tournaments/coupe-noel-u11-bonneville/registrations',
      headers: { ...as(orga), 'x-organization': 'avenir-des-bornes' },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toContainEqual(
      expect.objectContaining({
        managerName: 'Compte supprimé',
        email: null,
        phone: '',
      }),
    );
  });

  it('refuse tant que le compte est seul propriétaire d’un club', async () => {
    const token = await login(app, 'chloe@example.com');
    const club = await app.inject({
      method: 'POST',
      url: '/api/v1/clubs',
      headers: as(token),
      payload: { name: 'US Cluses' },
    });
    expect(club.statusCode).toBe(201);

    const refused = await remove(token, 'chloe@example.com');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ detail: string }>().detail).toContain('US Cluses');

    // Un second propriétaire : la suppression passe.
    await login(app, 'marc@example.com');
    const [chloe, marc] = await Promise.all(
      ['chloe@example.com', 'marc@example.com'].map((email) =>
        prisma.user.findUniqueOrThrow({ where: { email } }),
      ),
    );
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: chloe!.id },
    });
    await prisma.membership.create({
      data: {
        userId: marc!.id,
        organizationId: membership.organizationId,
        role: 'OWNER',
      },
    });
    expect((await remove(token, 'chloe@example.com')).statusCode).toBe(204);
  });

  it('garde les comptes de test', async () => {
    const token = await login(app, 'spectateur@example.org');
    const res = await remove(token, 'spectateur@example.org');
    expect(res.statusCode).toBe(409);
  });

  it('purge les données arrivées au bout de leur conservation', async () => {
    const now = DEMO_NOW.getTime();
    const ago = (days: number) => new Date(now - days * DAY);
    await login(app, 'lea@example.com');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'lea@example.com' },
    });
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: 'coupe-noel-u11-bonneville' },
    });
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: 'stade-du-mont-blanc' },
    });
    await prisma.loginCode.createMany({
      data: [
        { email: 'x@example.com', codeHash: 'a', expiresAt: ago(2) },
        { email: 'y@example.com', codeHash: 'b', expiresAt: ago(0.1) },
      ],
    });
    await prisma.session.createMany({
      data: [
        { userId: user.id, refreshHash: 'expired', expiresAt: ago(1) },
        {
          userId: user.id,
          refreshHash: 'revoked-old',
          expiresAt: ago(-10),
          revokedAt: ago(40),
        },
        {
          userId: user.id,
          refreshHash: 'revoked-new',
          expiresAt: ago(-10),
          revokedAt: ago(2),
        },
      ],
    });
    await prisma.invitation.createMany({
      data: [
        {
          organizationId: organization.id,
          email: 'old@example.com',
          role: 'STAFF',
          tokenHash: 'old',
          expiresAt: ago(35),
        },
        {
          organizationId: organization.id,
          email: 'new@example.com',
          role: 'STAFF',
          tokenHash: 'new',
          expiresAt: ago(-5),
        },
      ],
    });
    const registration = (status: 'EXPIRED' | 'CONFIRMED', days: number) => ({
      tournamentId: tournament.id,
      managerId: user.id,
      teamName: `Équipe ${status} ${days}`,
      club: 'FC Test',
      managerName: 'Léa Martin',
      phone: '06',
      players: [],
      status,
      feeCents: 0,
      serviceFeeCents: 0,
      totalCents: 0,
      idempotencyKey: `${status}-${days}`,
      createdAt: ago(days),
      paidAt: status === 'CONFIRMED' ? ago(days) : null,
    });
    await prisma.registration.createMany({
      data: [
        registration('EXPIRED', 40),
        registration('EXPIRED', 5),
        registration('CONFIRMED', 40),
      ],
    });
    await prisma.pushSubscription.create({
      data: {
        endpoint: 'https://push.example.com/stale',
        p256dh: 'p',
        auth: 'a',
        updatedAt: ago(200),
      },
    });
    const kept = {
      sessions: await prisma.session.count(),
      invitations: await prisma.invitation.count(),
    };

    const report = await app.get(MaintenanceService).purge();
    expect(report).toEqual({
      loginCodes: expect.any(Number),
      sessions: 2,
      invitations: expect.any(Number),
      registrations: 1,
      pushSubscriptions: 1,
      idempotencyKeys: expect.any(Number),
    });
    expect(
      await prisma.loginCode.count({ where: { email: 'x@example.com' } }),
    ).toBe(0);
    expect(
      await prisma.loginCode.count({ where: { email: 'y@example.com' } }),
    ).toBe(1);
    expect(await prisma.session.count()).toBe(kept.sessions - 2);
    expect(
      await prisma.session.count({ where: { refreshHash: 'revoked-new' } }),
    ).toBe(1);
    expect(await prisma.invitation.count({ where: { tokenHash: 'old' } })).toBe(
      0,
    );
    expect(await prisma.invitation.count({ where: { tokenHash: 'new' } })).toBe(
      1,
    );
    expect(kept.invitations - (await prisma.invitation.count())).toBe(
      report.invitations,
    );
    expect(
      await prisma.registration.findMany({
        where: { managerId: user.id },
        select: { idempotencyKey: true },
        orderBy: { idempotencyKey: 'asc' },
      }),
    ).toEqual([
      { idempotencyKey: 'CONFIRMED-40' },
      { idempotencyKey: 'EXPIRED-5' },
    ]);
  });
});
