import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login } from './setup-app.js';

const draft = {
  name: 'Open suisse U13',
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
  categories: ['U13'],
  maxTeams: 16,
  feeEuros: 0,
  registrationDeadline: '2026-11-30',
  format: 'swiss',
  matchMinutes: 12,
  breakMinutes: 3,
};

interface PublicMatch {
  id: string;
  phase: string;
  round?: number;
  startsAt: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
}

describe('Système suisse (e2e)', () => {
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
  ) =>
    app.inject({
      method,
      url: `/api/v1/organizer${url}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization': 'etoile-de-l-arve',
      },
      ...(payload ? { payload } : {}),
    });

  const tournamentWith = async (n: number) => {
    const created = await call('POST', '/tournaments', draft);
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

  const detail = async (slug: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/public/tournaments/${slug}`,
      })
    ).json<{
      format: string;
      swissRounds?: number;
      matches: PublicMatch[];
      standings: {
        group: string;
        rows: {
          teamId: string;
          points: number;
          buchholz?: number;
          byes?: number;
        }[];
      }[];
    }>();

  /** Termine un match par la table de marque : l'équipe au plus petit numéro gagne. */
  const finish = async (slug: string, match: PublicMatch) => {
    const link = await call(
      'POST',
      `/tournaments/${slug}/matches/${match.id}/reporter-link`,
    );
    const { token: linkToken } = link.json<{ token: string }>();
    const homeWins =
      Number(match.homeTeamId!.slice(1)) < Number(match.awayTeamId!.slice(1));
    let n = 0;
    for (const event of [
      { type: 'GOAL', side: homeWins ? 'home' : 'away' },
      { type: 'FULL_TIME' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/reporter/${linkToken}/events`,
        payload: {
          clientEventId: `${slug}-${match.id}-${(n += 1)}`,
          minute: 10,
          ...event,
        },
      });
      expect(res.statusCode).toBe(200);
    }
  };

  it('tire la première ronde, puis apparie chaque ronde à la fin de la précédente', async () => {
    const { slug, id } = await tournamentWith(5);
    const drawn = await call('POST', `/tournaments/${slug}/draw`, {
      seed: 'suisse-2026',
    });
    expect(drawn.statusCode).toBe(200);
    expect(drawn.json()).toMatchObject({
      format: 'swiss',
      seed: 'suisse-2026',
      started: false,
      groups: [],
      matches: 2,
      swiss: { rounds: 4, drawn: 1 },
    });
    // 5 équipes : une exempte par ronde, comptée comme une victoire.
    const exempt = await prisma.team.findMany({
      where: { tournamentId: id, byeRounds: { has: 1 } },
    });
    expect(exempt).toHaveLength(1);

    let page = await detail(slug);
    expect(page).toMatchObject({ format: 'swiss', swissRounds: 4 });
    expect(page.matches.map((m) => [m.id, m.phase, m.round])).toEqual([
      ['r1-1', 'swiss', 1],
      ['r1-2', 'swiss', 1],
    ]);
    expect(page.standings).toHaveLength(1);
    expect(page.standings[0]!.group).toBe('');
    expect(page.standings[0]!.rows[0]).toMatchObject({
      teamId: exempt[0]!.code,
      points: 3,
      byes: 1,
    });

    const seen = new Set<string>();
    for (let round = 1; round <= 4; round += 1) {
      page = await detail(slug);
      const current = page.matches.filter((m) => m.round === round);
      expect(current).toHaveLength(2);
      for (const m of current) {
        const pair = [m.homeTeamId!, m.awayTeamId!]
          .sort((a, b) => a.localeCompare(b))
          .join('|');
        expect(seen.has(pair)).toBe(false);
        seen.add(pair);
      }
      // Pas de ronde suivante tant que celle-ci n'est pas terminée.
      await finish(slug, current[0]!);
      expect(
        (await detail(slug)).matches.filter((m) => m.round === round + 1),
      ).toHaveLength(0);
      await finish(slug, current[1]!);
    }

    page = await detail(slug);
    // 4 rondes jouées, pas de cinquième.
    expect(page.matches).toHaveLength(8);
    const r2 = page.matches.find((m) => m.id === 'r2-1')!;
    const r1 = page.matches.find((m) => m.id === 'r1-1')!;
    expect(Date.parse(r2.startsAt)).toBeGreaterThan(Date.parse(r1.startsAt));
    const rows = page.standings[0]!.rows;
    expect(rows[0]).toMatchObject({ teamId: 'e1', points: 12 });
    expect(rows.every((r) => typeof r.buchholz === 'number')).toBe(true);
    const teams = await prisma.team.findMany({ where: { tournamentId: id } });
    expect(new Set(teams.flatMap((t) => t.byeRounds)).size).toBe(4);
    expect(
      (await call('GET', `/tournaments/${slug}/draw`)).json(),
    ).toMatchObject({ started: true, swiss: { rounds: 4, drawn: 4 } });
  });

  it('apparie de nouveau la ronde à venir si un score est corrigé, et la retire si la ronde précédente est rouverte', async () => {
    const { slug } = await tournamentWith(4);
    await call('POST', `/tournaments/${slug}/draw`, { seed: 'correction' });
    const first = (await detail(slug)).matches;
    const links: Record<string, string> = {};
    for (const m of first) {
      await finish(slug, m);
      const link = await call(
        'POST',
        `/tournaments/${slug}/matches/${m.id}/reporter-link`,
      );
      links[m.id] = link.json<{ token: string }>().token;
    }
    const before = (await detail(slug)).matches.filter((m) => m.round === 2);
    expect(before).toHaveLength(2);

    // Annuler la fin d'un match de la ronde 1 retire la ronde 2.
    const events = await prisma.matchEvent.findMany({
      where: {
        match: { code: 'r1-1', tournament: { slug } },
        type: 'FULL_TIME',
      },
    });
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/reporter/${links['r1-1']}/events`,
      payload: {
        clientEventId: 'annule-fin',
        minute: 12,
        type: 'CANCEL',
        cancels: events[0]!.clientEventId,
      },
    });
    expect(cancel.statusCode).toBe(200);
    expect(
      (await detail(slug)).matches.filter((m) => m.round === 2),
    ).toHaveLength(0);

    // Nouvelle fin du match : la ronde 2 revient.
    const end = await app.inject({
      method: 'POST',
      url: `/api/v1/reporter/${links['r1-1']}/events`,
      payload: { clientEventId: 'nouvelle-fin', minute: 12, type: 'FULL_TIME' },
    });
    expect(end.statusCode).toBe(200);
    const after = (await detail(slug)).matches.filter((m) => m.round === 2);
    expect(after.map((m) => [m.homeTeamId, m.awayTeamId])).toEqual(
      before.map((m) => [m.homeTeamId, m.awayTeamId]),
    );
    // Un match de système suisse n'attend jamais de vainqueur.
    expect(
      (
        await call('PUT', `/tournaments/${slug}/matches/r1-1/winner`, {
          side: 'home',
        })
      ).statusCode,
    ).toBe(409);
  });
});
