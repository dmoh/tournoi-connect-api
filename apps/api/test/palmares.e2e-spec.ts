import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login } from './setup-app.js';

const draft = {
  name: 'Coupe du printemps U11',
  sport: 'football',
  date: '2026-12-05',
  startTime: '09:00',
  endTime: '12:00',
  venueName: 'Stade des Esserts',
  city: 'Cluses',
  lat: 46.0606,
  lng: 6.5797,
  fields: 2,
  outdoor: true,
  categories: ['U11'],
  maxTeams: 8,
  feeEuros: 0,
  registrationDeadline: '2026-11-30',
  format: 'knockout',
  matchMinutes: 12,
  breakMinutes: 3,
};

describe('Palmarès (e2e)', () => {
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

  const organizer = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1/organizer${url}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization': 'etoile-de-l-arve',
      },
      ...(payload ? { payload } : {}),
    });
  const palmares = (slug: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/public/tournaments/${slug}/palmares`,
    });

  /** Saisies de la table de marque sur un match. */
  const reporter = async (slug: string, code: string) => {
    const link = await organizer(
      'POST',
      `/tournaments/${slug}/matches/${code}/reporter-link`,
    );
    const linkToken = link.json<{ token: string }>().token;
    let n = 0;
    return (event: object) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/reporter/${linkToken}/events`,
        payload: {
          clientEventId: `${slug}-${code}-${(n += 1)}`,
          minute: 8,
          ...event,
        },
      });
  };

  it('le vainqueur de la finale remporte le tournoi, qui passe terminé ; une annulation le rouvre', async () => {
    const created = await organizer('POST', '/tournaments', draft);
    const { slug } = created.json<{ slug: string }>();
    const t = await prisma.tournament.findUniqueOrThrow({ where: { slug } });
    await prisma.team.createMany({
      data: ['Aigles', 'Bisons', 'Castors', 'Dauphins'].map((name, i) => ({
        tournamentId: t.id,
        code: `e${i + 1}`,
        name,
        shortName: name.slice(0, 3).toUpperCase(),
        club: 'Club',
      })),
    });
    await prisma.tournament.update({
      where: { id: t.id },
      data: { status: 'IN_PROGRESS' },
    });
    expect(
      (
        await organizer('POST', `/tournaments/${slug}/draw`, {
          seed: 'printemps',
        })
      ).statusCode,
    ).toBe(200);

    const before = await palmares(slug);
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      complete: false,
      podium: null,
      scorers: [],
    });

    // Demies : l'équipe à domicile gagne, avec ses buteurs.
    for (const code of ['df1', 'df2']) {
      const play = await reporter(slug, code);
      await play({ type: 'GOAL', side: 'home', player: 'Léo Martin' });
      await play({
        type: 'GOAL',
        side: 'home',
        player: code === 'df1' ? 'Inès' : 'Léo Martin',
      });
      expect((await play({ type: 'FULL_TIME' })).statusCode).toBe(200);
    }
    const final = await prisma.match.findFirstOrThrow({
      where: { tournamentId: t.id, code: 'f' },
    });
    expect(final.homeTeamCode).not.toBeNull();
    expect((await palmares(slug)).json().complete).toBe(false);

    const play = await reporter(slug, 'f');
    await play({ type: 'GOAL', side: 'away', player: 'Noé' });
    const end = await play({ type: 'FULL_TIME' });
    expect(end.statusCode).toBe(200);

    const semis = await prisma.match.findMany({
      where: { tournamentId: t.id, phase: 'semi' },
      orderBy: { code: 'asc' },
    });
    const view = (await palmares(slug)).json();
    expect(view).toMatchObject({
      complete: true,
      podium: {
        first: final.awayTeamCode,
        second: final.homeTeamCode,
        // Pas de petite finale : les deux demi-finalistes battus, ex aequo.
        third: semis.map((m) => m.awayTeamCode),
      },
    });
    expect(view.scorers[0]).toMatchObject({ player: 'Léo Martin', goals: 2 });
    expect(
      (await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('COMPLETED');

    // La fin de la finale annulée : plus de champion, le tournoi est de nouveau en cours.
    await play({ type: 'CANCEL', cancels: `${slug}-f-2` });
    expect((await palmares(slug)).json()).toMatchObject({
      complete: false,
      podium: null,
    });
    expect(
      (await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } }))
        .status,
    ).toBe('IN_PROGRESS');
    // Le but annulé ne compte plus.
    await play({ type: 'CANCEL', cancels: `${slug}-f-1` });
    expect(
      (await palmares(slug))
        .json()
        .scorers.find((s: { player: string }) => s.player === 'Noé'),
    ).toBeUndefined();

    expect((await palmares('tournoi-inconnu')).statusCode).toBe(404);
  });
});
