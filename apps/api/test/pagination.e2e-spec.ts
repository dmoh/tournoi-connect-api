import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { encodeCursor } from '../src/common/pagination.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login } from './setup-app.js';

/**
 * Pagination par curseur des listes : première page, pages suivantes par
 * nextCursor, dernière page, bornes de limit, curseur falsifié, stabilité
 * sur des dates égales. Les lignes en plus des données de démonstration
 * sont créées ici, jamais dans le seed partagé.
 */
describe('Pagination par curseur (e2e)', () => {
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

  const get = (url: string, token?: string, headers = {}) =>
    app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });

  /** Lit toutes les pages en suivant nextCursor ; rend chaque page. */
  async function readPages<T>(
    url: string,
    token?: string,
    headers = {},
  ): Promise<T[][]> {
    const pages: T[][] = [];
    let cursor: string | null = null;
    do {
      const sep = url.includes('?') ? '&' : '?';
      const res = await get(
        cursor ? `${url}${sep}cursor=${cursor}` : url,
        token,
        headers,
      );
      expect(res.statusCode).toBe(200);
      const body = res.json<{ items: T[]; nextCursor: string | null }>();
      pages.push(body.items);
      cursor = body.nextCursor;
    } while (cursor && pages.length < 50);
    return pages;
  }

  /** Limite hors bornes et curseurs falsifiés : 400 en problem+json. */
  async function expectRejects(url: string, token?: string, headers = {}) {
    const sep = url.includes('?') ? '&' : '?';
    const forged = [
      'pas-un-curseur',
      encodeCursor('autre-liste', ['2026-11-09T10:00:00.000Z', 'x']),
      Buffer.from('["x"').toString('base64url'),
    ];
    for (const query of [
      'limit=0',
      'limit=51',
      'limit=abc',
      'cursor=%2F%2F',
      ...forged.map((c) => `cursor=${c}`),
    ]) {
      const res = await get(`${url}${sep}${query}`, token, headers);
      expect(res.statusCode, query).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
    }
  }

  async function liveTournament() {
    return prisma.tournament.findUniqueOrThrow({
      where: { slug: 'challenge-u13-arve' },
      include: { venue: true },
    });
  }

  describe('fil News', () => {
    it('pagine les posts du plus récent au plus ancien, dates égales départagées par id', async () => {
      const t = await liveTournament();
      // 7 posts de la même milliseconde, plus récents que ceux de la démo.
      const same = new Date('2026-11-09T11:08:00.000Z');
      await prisma.post.createMany({
        data: Array.from({ length: 7 }, (_, i) => ({
          tournamentId: t.id,
          kind: 'ANNOUNCEMENT' as const,
          title: `Annonce ${i}`,
          body: '',
          publishedAt: same,
        })),
      });
      const expected = (
        await prisma.post.findMany({
          where: { tournamentId: t.id },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
      ).map((p) => p.id);
      expect(expected).toHaveLength(12);

      const url = '/public/tournaments/challenge-u13-arve/news?limit=5';
      const pages = await readPages<{ type: string; id?: string }>(url);
      const posts = pages.map((page) =>
        page.filter((i) => i.type === 'post').map((i) => i.id),
      );
      expect(posts.map((p) => p.length)).toEqual([5, 5, 2]);
      expect(posts.flat()).toEqual(expected);
      // Jamais de carte sponsorisée en tête ni en fin de page.
      for (const page of pages) {
        expect(page[0]!.type).toBe('post');
        expect(page.at(-1)!.type).toBe('post');
      }
      // La rotation continue : la deuxième page ne recommence pas par l'Or.
      const sponsored = pages
        .flat()
        .filter((i) => i.type === 'sponsored') as unknown as {
        sponsor: { tier: string };
      }[];
      expect(sponsored.map((s) => s.sponsor.tier)).toEqual(['GOLD', 'SILVER']);

      const first = (await get(url)).json();
      expect(first.nextCursor).toEqual(expect.any(String));
      const last = (await get(`${url}&cursor=${first.nextCursor}`)).json();
      expect(last.items[0].id).toBe(expected[5]);
    });

    it('rend une seule page par défaut et refuse limit et curseur invalides', async () => {
      const res = await get('/public/tournaments/challenge-u13-arve/news');
      expect(res.json().nextCursor).toBeNull();
      await expectRejects('/public/tournaments/challenge-u13-arve/news');
    });
  });

  describe('Explorer', () => {
    it('pagine par (distance, date, id), lieu et date égaux départagés par id', async () => {
      const t = await liveTournament();
      for (const n of [1, 2, 3]) {
        await prisma.tournament.create({
          data: {
            slug: `meme-lieu-${n}`,
            name: `Même lieu ${n}`,
            sport: 'football',
            startsAt: new Date('2026-11-20T09:00:00+01:00'),
            endsAt: new Date('2026-11-20T17:00:00+01:00'),
            maxTeams: 8,
            status: 'REGISTRATION_OPEN',
            organizationId: t.organizationId,
            venueId: t.venueId,
          },
        });
      }
      const url = '/public/tournaments?lat=46.0606&lng=6.5797&radiusKm=25';
      const all = (await get(url)).json();
      expect(all.nextCursor).toBeNull();
      const slugs = all.items.map((i: { slug: string }) => i.slug);
      expect(slugs).toHaveLength(6);
      const twins = await prisma.tournament.findMany({
        where: { slug: { startsWith: 'meme-lieu-' } },
        orderBy: { id: 'asc' },
      });
      // Même distance, même début : l'ordre est celui des id.
      expect(slugs.slice(1, 4)).toEqual(twins.map((x) => x.slug));

      for (const limit of [1, 2, 4]) {
        const pages = await readPages<{ slug: string }>(
          `${url}&limit=${limit}`,
        );
        expect(pages.flat().map((i) => i.slug)).toEqual(slugs);
        expect(pages.at(-1)!.length).toBeGreaterThan(0);
      }
      await expectRejects(url);
    });
  });

  describe('mes équipes', () => {
    it('pagine mes inscriptions, plus récentes en tête', async () => {
      const token = await login(app, 'capitaine@example.org');
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'capitaine@example.org' },
      });
      const t = await prisma.tournament.findUniqueOrThrow({
        where: { slug: 'tournoi-11-novembre-u15' },
      });
      const same = new Date('2026-11-01T10:00:00.000Z');
      await prisma.registration.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          tournamentId: t.id,
          managerId: user.id,
          teamName: `Équipe ${i}`,
          club: '',
          managerName: 'Capitaine',
          phone: '0600000000',
          players: [],
          status: 'CONFIRMED' as const,
          feeCents: 0,
          serviceFeeCents: 0,
          totalCents: 0,
          idempotencyKey: `pagination-mine-${i}`,
          createdAt: i === 4 ? new Date('2026-11-02T10:00:00.000Z') : same,
        })),
      });
      const expected = (
        await prisma.registration.findMany({
          where: { managerId: user.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        })
      ).map((r) => r.id);

      const pages = await readPages<{ orderId: string }>(
        '/registrations?limit=2',
        token,
      );
      expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
      expect(pages.flat().map((r) => r.orderId)).toEqual(expected);
      expect(pages[0]![0]!.orderId).toBe(expected[0]);
      await expectRejects('/registrations', token);
    });
  });

  describe('tournois de l’organisateur', () => {
    it('pagine par (début, id), les plus proches en premier', async () => {
      const t = await liveTournament();
      for (const n of [1, 2, 3, 4]) {
        await prisma.tournament.create({
          data: {
            slug: `club-${n}`,
            name: `Club ${n}`,
            sport: 'football',
            startsAt: new Date('2026-12-01T09:00:00+01:00'),
            endsAt: new Date('2026-12-01T17:00:00+01:00'),
            maxTeams: 8,
            status: n === 4 ? 'ARCHIVED' : 'DRAFT',
            organizationId: t.organizationId,
            venueId: t.venueId,
          },
        });
      }
      const twins = (
        await prisma.tournament.findMany({
          where: { slug: { in: ['club-1', 'club-2', 'club-3'] } },
          orderBy: { id: 'asc' },
        })
      ).map((x) => x.slug);
      const token = await login(app);
      const pages = await readPages<{ slug: string }>(
        '/organizer/tournaments?limit=2',
        token,
      );
      expect(pages.map((p) => p.map((i) => i.slug))).toEqual([
        ['challenge-u13-arve', twins[0]],
        [twins[1], twins[2]],
      ]);
      await expectRejects('/organizer/tournaments', token);
    });
  });

  describe('inscriptions d’un tournoi (tableau organisateur)', () => {
    const club = { 'x-organization': 'stade-du-mont-blanc' };
    const base = '/organizer/tournaments/tournoi-11-novembre-u15/registrations';
    let token: string;
    let all: { id: string; teamName: string; createdAt: Date }[];

    beforeEach(async () => {
      const t = await prisma.tournament.findUniqueOrThrow({
        where: { slug: 'tournoi-11-novembre-u15' },
      });
      const same = new Date('2026-11-01T10:00:00.000Z');
      const rows = [
        { teamName: 'Delta', status: 'CONFIRMED' },
        { teamName: 'alpha', status: 'CONFIRMED' },
        { teamName: 'Charlie', status: 'WAITLISTED' },
        // Place tenue dont le paiement a expiré : affichée EXPIRED.
        {
          teamName: 'Bravo',
          status: 'PENDING_PAYMENT',
          expiresAt: new Date('2026-11-01T10:31:00.000Z'),
        },
        {
          teamName: 'Echo',
          status: 'PENDING_PAYMENT',
          expiresAt: new Date('2026-11-09T12:00:00+01:00'),
        },
        { teamName: 'Foxtrot', status: 'EXPIRED' },
        { teamName: 'Delta', status: 'CANCELLED' },
      ] as const;
      await prisma.registration.createMany({
        data: rows.map((r, i) => ({
          tournamentId: t.id,
          managerId: null,
          club: '',
          managerName: 'Responsable',
          phone: '0600000000',
          players: [],
          feeCents: 0,
          serviceFeeCents: 0,
          totalCents: 0,
          idempotencyKey: `pagination-orga-${i}`,
          createdAt: i < 4 ? same : new Date(same.getTime() + i * 60_000),
          ...r,
        })),
      });
      all = await prisma.registration.findMany({
        where: { tournamentId: t.id },
      });
      token = await login(app, 'multi@example.org');
    });

    const ids = (pages: { id: string }[][]) => pages.flat().map((r) => r.id);
    const sorted = (
      compare: (
        a: { id: string; teamName: string; createdAt: Date },
        b: { id: string; teamName: string; createdAt: Date },
      ) => number,
    ) => [...all].sort(compare).map((r) => r.id);

    it('trie par date d’inscription, dans les deux sens, départagé par id', async () => {
      const byDate = (
        a: { id: string; createdAt: Date },
        b: { id: string; createdAt: Date },
      ) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const asc = await readPages<{ id: string }>(
        `${base}?limit=3`,
        token,
        club,
      );
      expect(asc.map((p) => p.length)).toEqual([3, 3, 1]);
      expect(ids(asc)).toEqual(sorted(byDate));
      const desc = await readPages<{ id: string }>(
        `${base}?limit=3&sort=-createdAt`,
        token,
        club,
      );
      expect(ids(desc)).toEqual(sorted((a, b) => byDate(b, a)));
    });

    it('trie par nom d’équipe, homonymes départagés par id', async () => {
      const byName = await readPages<{ id: string; teamName: string }>(
        `${base}?limit=2&sort=teamName`,
        token,
        club,
      );
      const names = byName.flat().map((r) => r.teamName);
      expect(names).toHaveLength(7);
      expect(new Set(ids(byName)).size).toBe(7);
      const reversed = await readPages<{ id: string }>(
        `${base}?limit=2&sort=-teamName`,
        token,
        club,
      );
      expect(ids(reversed)).toEqual([...ids(byName)].reverse());
      // Les deux « Delta » se suivent, dans l'ordre de leur id.
      const deltas = byName.flat().filter((r) => r.teamName === 'Delta');
      expect(deltas.map((r) => r.id)).toEqual(
        all
          .filter((r) => r.teamName === 'Delta')
          .map((r) => r.id)
          .sort(),
      );
    });

    it('filtre sur le statut affiché', async () => {
      const status = async (s: string) =>
        (
          await readPages<{ teamName: string; status: string }>(
            `${base}?status=${s}&sort=teamName`,
            token,
            club,
          )
        ).flat();
      expect((await status('EXPIRED')).map((r) => r.teamName)).toEqual([
        'Bravo',
        'Foxtrot',
      ]);
      expect(
        (await status('EXPIRED')).every((r) => r.status === 'EXPIRED'),
      ).toBe(true);
      expect((await status('PENDING_PAYMENT')).map((r) => r.teamName)).toEqual([
        'Echo',
      ]);
      expect((await status('CONFIRMED')).map((r) => r.teamName).sort()).toEqual(
        ['Delta', 'alpha'],
      );
      // Filtre et tri combinés à la pagination.
      const confirmed = await readPages<{ teamName: string }>(
        `${base}?status=CONFIRMED&sort=-createdAt&limit=1`,
        token,
        club,
      );
      expect(confirmed.map((p) => p.length)).toEqual([1, 1]);
    });

    it('refuse un tri, un statut, une limite ou un curseur invalides', async () => {
      for (const query of ['sort=email', 'status=PAID']) {
        expect((await get(`${base}?${query}`, token, club)).statusCode).toBe(
          400,
        );
      }
      await expectRejects(base, token, club);
      // Curseur d'un autre tri : refusé plutôt que mal interprété.
      const first = (await get(`${base}?limit=1`, token, club)).json();
      expect(
        (
          await get(
            `${base}?limit=1&sort=teamName&cursor=${first.nextCursor}`,
            token,
            club,
          )
        ).statusCode,
      ).toBe(400);
      // Tournoi d'un autre club : 404.
      expect(
        (
          await get(
            '/organizer/tournaments/challenge-u13-arve/registrations',
            token,
            club,
          )
        ).statusCode,
      ).toBe(404);
    });
  });

  describe('membres du club', () => {
    it('pagine par rôle puis arrivée, invitations à chaque page', async () => {
      const t = await liveTournament();
      const joined = new Date('2026-11-05T10:00:00.000Z');
      for (const n of [1, 2, 3, 4]) {
        await prisma.user.create({
          data: {
            email: `staff${n}@example.org`,
            memberships: {
              create: {
                organizationId: t.organizationId,
                role: n === 4 ? 'ADMIN' : 'STAFF',
                createdAt: joined,
              },
            },
          },
        });
      }
      const token = await login(app);
      await app.inject({
        method: 'POST',
        url: '/api/v1/organizer/invitations',
        headers: { authorization: `Bearer ${token}` },
        payload: { email: 'nouveau@example.org', role: 'STAFF' },
      });
      const expected = await prisma.membership.findMany({
        where: { organizationId: t.organizationId },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { userId: 'asc' }],
      });
      expect(expected.length).toBeGreaterThan(4);

      const pages: { userId: string; role: string }[][] = [];
      let cursor: string | null = null;
      do {
        const res = await get(
          `/organizer/members?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
          token,
        );
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.yourRole).toBe('OWNER');
        expect(body.invitations).toEqual([
          expect.objectContaining({ email: 'nouveau@example.org' }),
        ]);
        pages.push(body.items);
        cursor = body.nextCursor;
      } while (cursor);
      expect(pages.flat().map((m) => m.userId)).toEqual(
        expected.map((m) => m.userId),
      );
      expect(pages.flat()[0]!.role).toBe('OWNER');
      expect(pages.at(-1)!.length).toBeGreaterThan(0);
      await expectRejects('/organizer/members', token);
    });
  });

  describe('matchs d’une journée', () => {
    const url = '/public/tournaments/challenge-u13-arve/matches';

    it('rend la journée du jour, par créneau puis par phase', async () => {
      const res = await get(url);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        day: '2026-11-09',
        days: ['2026-11-09'],
        previousDay: null,
        nextDay: null,
      });
      const matches = body.slots.flatMap(
        (s: { phases: { matches: unknown[] }[] }) =>
          s.phases.flatMap((p) => p.matches),
      );
      expect(matches).toHaveLength(15);
      const first = body.slots[0];
      expect(first.startsAt).toBe('2026-11-09T08:00:00.000Z');
      expect(first.phases[0].phase).toBe('groups');
      expect(first.phases[0].matches.map((m: { id: string }) => m.id)).toEqual([
        'a1',
        'b1',
      ]);
      // Créneaux dans l'ordre, chacun de matchs de même heure.
      const starts = body.slots.map((s: { startsAt: string }) => s.startsAt);
      expect([...starts].sort()).toEqual(starts);
      expect(new Set(starts).size).toBe(starts.length);
    });

    it('lit une autre journée par ?day= et donne les ancres voisines', async () => {
      const t = await liveTournament();
      // Lendemain, 0 h 30 à Paris : encore le 10 novembre en heure de Paris.
      await prisma.match.createMany({
        data: [
          {
            tournamentId: t.id,
            code: 'j2a',
            phase: 'final',
            field: 'Terrain 1',
            startsAt: new Date('2026-11-09T23:30:00.000Z'),
          },
          {
            tournamentId: t.id,
            code: 'j2b',
            phase: 'groups',
            group: 'A',
            field: 'Terrain 2',
            startsAt: new Date('2026-11-09T23:30:00.000Z'),
          },
        ],
      });
      const today = (await get(url)).json();
      expect(today.days).toEqual(['2026-11-09', '2026-11-10']);
      expect(today.nextDay).toBe('2026-11-10');

      const next = (await get(`${url}?day=2026-11-10`)).json();
      expect(next).toMatchObject({
        day: '2026-11-10',
        previousDay: '2026-11-09',
        nextDay: null,
      });
      expect(next.slots).toHaveLength(1);
      // Phase de groupes avant la finale dans le même créneau.
      expect(
        next.slots[0].phases.map((p: { phase: string }) => p.phase),
      ).toEqual(['groups', 'final']);

      const empty = (await get(`${url}?day=2026-11-12`)).json();
      expect(empty.slots).toEqual([]);
      expect(empty.previousDay).toBe('2026-11-10');

      for (const day of ['2026-13-01', '09-11-2026', 'demain']) {
        expect((await get(`${url}?day=${day}`)).statusCode).toBe(400);
      }
      expect(
        (await get('/public/tournaments/inconnu/matches')).statusCode,
      ).toBe(404);
    });
  });
});
