import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login } from './setup-app.js';

const LIVE = 'challenge-u13-arve';

const draft = {
  name: 'Coupe d’hiver U13',
  sport: 'football',
  date: '2026-12-05',
  startTime: '09:00',
  endTime: '10:30',
  venueName: 'Stade des Esserts',
  city: 'Cluses',
  lat: 46.0606,
  lng: 6.5797,
  fields: 2,
  outdoor: true,
  categories: ['U13'],
  maxTeams: 16,
  feeEuros: 0,
  registrationDeadline: '2026-11-30',
  format: 'groups-knockout',
  matchMinutes: 12,
  breakMinutes: 3,
};

describe('Tirage, calendrier et phase finale (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let token: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    token = await login(app);
  });
  afterAll(() => app.close());

  const call = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: object,
    as = token,
  ) =>
    app.inject({
      method,
      url: `/api/v1/organizer${url}`,
      headers: {
        authorization: `Bearer ${as}`,
        'x-organization': 'etoile-de-l-arve',
      },
      ...(payload ? { payload } : {}),
    });

  /** Nouveau tournoi du club avec `n` équipes inscrites. */
  const tournamentWith = async (n: number, format = 'groups-knockout') => {
    const created = await call('POST', '/tournaments', { ...draft, format });
    expect(created.statusCode).toBe(201);
    const { slug } = created.json<{ slug: string }>();
    const t = await prisma.tournament.findUniqueOrThrow({ where: { slug } });
    await prisma.team.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        tournamentId: t.id,
        code: `e${i + 1}`,
        name: `Équipe ${String(i + 1).padStart(2, '0')}`,
        shortName: `E${i + 1}`,
        club: 'Club',
      })),
    });
    return { slug, id: t.id };
  };

  /** Saisie de la table de marque sur un match du tournoi en cours. */
  const reporter = async (match: string) => {
    const link = await call(
      'POST',
      `/tournaments/${LIVE}/matches/${match}/reporter-link`,
    );
    const { token: linkToken } = link.json<{ token: string }>();
    let n = 0;
    return (event: object) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/reporter/${linkToken}/events`,
        payload: {
          clientEventId: `${match}-evt-${(n += 1)}`,
          minute: 10,
          ...event,
        },
      });
  };

  const liveMatch = async (code: string) =>
    prisma.match.findFirstOrThrow({
      where: { code, tournament: { slug: LIVE } },
    });

  it('tire 8 équipes en 2 poules et génère tout le calendrier', async () => {
    const { slug } = await tournamentWith(8);
    const res = await call('POST', `/tournaments/${slug}/draw`, {
      seed: 'hiver-2026',
    });
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view).toMatchObject({
      format: 'groups-knockout',
      seed: 'hiver-2026',
      started: false,
    });
    expect(
      view.groups.map((g: { teams: unknown[] }) => g.teams.length),
    ).toEqual([4, 4]);
    // 2 × 6 matchs de poule, 2 demies, petite finale et finale.
    expect(view.matches).toBe(16);

    const page = await app.inject({
      method: 'GET',
      url: `/api/v1/public/tournaments/${slug}`,
    });
    const matches = page.json().matches as {
      id: string;
      phase: string;
      startsAt: string;
      field: string;
      homePlaceholder?: string;
    }[];
    // Premier match à 9 h, heure de Paris.
    expect(Date.parse(matches[0]!.startsAt)).toBe(
      Date.parse('2026-12-05T09:00:00+01:00'),
    );
    expect(matches.find((m) => m.id === 'df1')).toMatchObject({
      phase: 'semi',
      homePlaceholder: '1er poule A',
    });
    expect(matches.find((m) => m.id === 'pf')?.phase).toBe('third-place');
    // Deux terrains, jamais plus de deux matchs à la même heure.
    const perSlot = new Map<string, number>();
    for (const m of matches)
      perSlot.set(m.startsAt, (perSlot.get(m.startsAt) ?? 0) + 1);
    expect(Math.max(...perSlot.values())).toBeLessThanOrEqual(2);
    // 8 créneaux de 15 min : le dernier match finit vers 10 h 57, après 10 h 30.
    expect(view.overrunMinutes).toBe(27);
    expect(Date.parse(view.endsAt)).toBe(
      Date.parse('2026-12-05T10:57:00+01:00'),
    );

    // Même graine, même tirage ; autre graine, autre tirage.
    const again = (
      await call('POST', `/tournaments/${slug}/draw`, { seed: 'hiver-2026' })
    ).json();
    expect(again.groups).toEqual(view.groups);
    const other = (
      await call('POST', `/tournaments/${slug}/draw`, { seed: 'autre' })
    ).json();
    expect(other.groups).not.toEqual(view.groups);
    expect((await call('GET', `/tournaments/${slug}/draw`)).json().seed).toBe(
      'autre',
    );
  });

  it('refuse un tirage sans équipes, en système suisse, ou hors du club', async () => {
    const empty = await tournamentWith(1);
    expect(
      (await call('POST', `/tournaments/${empty.slug}/draw`, {})).statusCode,
    ).toBe(409);
    const swiss = await tournamentWith(6, 'swiss');
    expect(
      (await call('POST', `/tournaments/${swiss.slug}/draw`, {})).statusCode,
    ).toBe(422);
    const staff = await login(app, 'benevole@example.org');
    expect(
      (await call('POST', `/tournaments/${swiss.slug}/draw`, {}, staff))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/tournaments/tournoi-11-novembre-u15/draw'))
        .statusCode,
    ).toBe(404);
  });

  it('fige le tirage dès qu’un match a commencé', async () => {
    expect(
      (await call('POST', `/tournaments/${LIVE}/draw`, {})).statusCode,
    ).toBe(409);
    expect(
      (await call('GET', `/tournaments/${LIVE}/draw`)).json(),
    ).toMatchObject({
      started: true,
      matches: 15,
    });
  });

  it('place les qualifiés à la fin des poules, puis le vainqueur aux tirs au but', async () => {
    // Fin des matchs en cours de la démo, puis des derniers matchs de poule.
    for (const code of ['a5', 'b5', 'b6']) {
      await prisma.match.updateMany({
        where: { code, tournament: { slug: LIVE } },
        data: { status: 'FINISHED' },
      });
    }
    expect((await liveMatch('df1')).homeTeamCode).toBeNull();
    const a6 = await reporter('a6');
    expect((await a6({ type: 'GOAL', side: 'home' })).statusCode).toBe(200);
    expect((await a6({ type: 'FULL_TIME' })).statusCode).toBe(200);

    const page = await app.inject({
      method: 'GET',
      url: `/api/v1/public/tournaments/${LIVE}`,
    });
    const [groupA, groupB] = page.json().standings as {
      rows: { teamId: string }[];
    }[];
    const df1 = await liveMatch('df1');
    const df2 = await liveMatch('df2');
    expect([df1.homeTeamCode, df1.awayTeamCode]).toEqual([
      groupA!.rows[0]!.teamId,
      groupB!.rows[1]!.teamId,
    ]);
    expect([df2.homeTeamCode, df2.awayTeamCode]).toEqual([
      groupB!.rows[0]!.teamId,
      groupA!.rows[1]!.teamId,
    ]);

    // Demie nulle : la table de marque désigne le vainqueur aux tirs au but.
    const semi = await reporter('df1');
    await semi({ type: 'GOAL', side: 'home' });
    await semi({ type: 'GOAL', side: 'away' });
    await semi({ type: 'FULL_TIME', side: 'away' });
    expect((await liveMatch('f')).homeTeamCode).toBe(df1.awayTeamCode);

    // Annuler la fin du match retire le qualifié de la finale.
    await semi({ type: 'CANCEL', cancels: 'df1-evt-3' });
    expect((await liveMatch('f')).homeTeamCode).toBeNull();
    expect((await liveMatch('df1')).winnerSide).toBeNull();

    // Fin sans vainqueur désigné : l'organisateur le choisit ensuite.
    await semi({ type: 'FULL_TIME' });
    expect((await liveMatch('f')).homeTeamCode).toBeNull();
    const winner = await call(
      'PUT',
      `/tournaments/${LIVE}/matches/df1/winner`,
      { side: 'home' },
    );
    expect(winner.statusCode).toBe(204);
    expect((await liveMatch('f')).homeTeamCode).toBe(df1.homeTeamCode);
    // Un match de poule n'attend jamais de vainqueur.
    expect(
      (
        await call('PUT', `/tournaments/${LIVE}/matches/a6/winner`, {
          side: 'home',
        })
      ).statusCode,
    ).toBe(409);
  });
});
