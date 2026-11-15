import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login } from './setup-app.js';

describe('Parrainage entre clubs (e2e)', () => {
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
  const referral = (token: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/organizer/referral',
      headers: as(token),
    });
  const createClub = (token: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/clubs',
      headers: as(token),
      payload,
    });

  it('donne au club un code stable et un lien de création de club', async () => {
    const orga = await login(app);
    const first = await referral(orga);
    expect(first.statusCode).toBe(200);
    const { code, url, clubs } = first.json<{
      code: string;
      url: string;
      clubs: unknown[];
    }>();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(url).toMatch(new RegExp(`/clubs/new\\?parrain=${code}$`));
    expect(clubs).toEqual([]);
    expect((await referral(orga)).json<{ code: string }>().code).toBe(code);

    const lookup = await app.inject({
      method: 'GET',
      url: `/api/v1/public/referrals/${code.toLowerCase()}`,
    });
    expect(lookup.json()).toEqual({
      club: { name: "Étoile de l'Arve", city: null },
    });
    for (const unknown of ['ZZZZZZZZ', 'pas-un-code']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/referrals/${unknown}`,
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('suit le club créé par le lien, et ignore un code inconnu', async () => {
    const orga = await login(app);
    const { code } = (await referral(orga)).json<{ code: string }>();

    const filleul = await login(app, 'filleul@example.com');
    const created = await createClub(filleul, {
      name: 'US Cluses',
      city: 'Cluses',
      referralCode: ` ${code.toLowerCase()} `,
    });
    expect(created.statusCode).toBe(201);
    const other = await login(app, 'autre@example.com');
    expect(
      (
        await createClub(other, {
          name: 'FC Marignier',
          referralCode: 'ZZZZZZZZ',
        })
      ).statusCode,
    ).toBe(201);

    expect((await referral(orga)).json()).toMatchObject({
      clubs: [{ name: 'US Cluses', city: 'Cluses', active: false }],
    });
    const marignier = await prisma.organization.findFirstOrThrow({
      where: { name: 'FC Marignier' },
    });
    expect(marignier.referredById).toBeNull();

    // Le filleul publie un tournoi : il devient actif chez son parrain.
    const cluses = await prisma.organization.findFirstOrThrow({
      where: { name: 'US Cluses' },
    });
    const template = await prisma.tournament.findFirstOrThrow({
      where: { slug: 'coupe-noel-u11-bonneville' },
    });
    await prisma.tournament.create({
      data: {
        organizationId: cluses.id,
        venueId: template.venueId,
        slug: 'tournoi-us-cluses',
        name: 'Tournoi de l’US Cluses',
        sport: template.sport,
        startsAt: template.startsAt,
        endsAt: template.endsAt,
        maxTeams: 8,
        status: 'REGISTRATION_OPEN',
      },
    });
    expect((await referral(orga)).json()).toMatchObject({
      clubs: [{ name: 'US Cluses', active: true }],
    });

    const admin = await login(app, 'plateforme@example.org');
    const overview = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/overview',
      headers: as(admin),
    });
    expect(overview.json()).toMatchObject({ counts: { referredClubs: 1 } });
  });

  it('réserve le lien aux admins du club', async () => {
    const staff = await login(app, 'benevole@example.org');
    expect((await referral(staff)).statusCode).toBe(404);
  });
});
