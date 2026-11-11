import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { PushService } from '../src/push/push.service.js';
import { createTestApp, login } from './setup-app.js';

describe('Table de marque du rapporteur (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let ORGANIZER_TOKEN = '';

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    ORGANIZER_TOKEN = await login(app);
  });
  afterAll(() => app.close());

  const link = async (match: string, as = ORGANIZER_TOKEN) => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/organizer/tournaments/challenge-u13-arve/matches/${match}/reporter-link`,
      headers: { authorization: `Bearer ${as}` },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { token: string; url: string; expiresAt: string };
  };
  const send = (token: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/reporter/${token}/events`,
      payload,
    });

  it('émet un lien de 24 heures qui ouvre le match avec les effectifs', async () => {
    const { token, url, expiresAt } = await link('a6');
    expect(url).toMatch(/\/r\/.+/);
    expect(expiresAt).toBe('2026-11-10T10:10:00.000Z');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/reporter/${token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      matchId: 'a6',
      tournamentSlug: 'challenge-u13-arve',
      home: { name: 'Racing du Giffre', shortName: 'RDG' },
      status: 'SCHEDULED',
    });
    expect(res.json().home.players).toHaveLength(8);
    expect(res.json().home.players[0]).toEqual({
      number: 1,
      name: expect.any(String),
    });
  });

  it('refuse un lien invalide et un match hors de l’organisation', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/reporter/a6-demo' }))
        .statusCode,
    ).toBe(404);
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/organizer/tournaments/coupe-noel-u11-bonneville/matches/a1/reporter-link',
      headers: { authorization: `Bearer ${ORGANIZER_TOKEN}` },
    });
    expect(other.statusCode).toBe(404);
  });

  it('compte un but une seule fois, l’annule, puis termine le match', async () => {
    const { token } = await link('a6');
    const goal = {
      clientEventId: 'evt-goal-0001',
      type: 'GOAL',
      side: 'home',
      minute: 4,
      player: 'T. Roux',
    };
    expect((await send(token, goal)).json()).toEqual({
      score: { home: 1, away: 0 },
      status: 'LIVE',
    });
    // Renvoi après une coupure : même clientEventId, pas de second but.
    expect((await send(token, goal)).json().score).toEqual({
      home: 1,
      away: 0,
    });
    await send(token, {
      clientEventId: 'evt-card-0002',
      type: 'YELLOW_CARD',
      side: 'away',
      minute: 6,
      player: 'H. Garcia',
    });
    const cancel = await send(token, {
      clientEventId: 'evt-undo-0003',
      type: 'CANCEL',
      minute: 7,
      cancels: 'evt-goal-0001',
    });
    expect(cancel.json().score).toEqual({ home: 0, away: 0 });
    const end = await send(token, {
      clientEventId: 'evt-end-00004',
      type: 'FULL_TIME',
      minute: 20,
    });
    expect(end.json()).toEqual({
      score: { home: 0, away: 0 },
      status: 'FINISHED',
    });

    const feed = await app.inject({
      method: 'GET',
      url: '/api/v1/public/tournaments/challenge-u13-arve/matches/a6/feed',
    });
    expect(feed.json().events.map((e: { type: string }) => e.type)).toEqual([
      'FULL_TIME',
      'YELLOW_CARD',
    ]);
    const detail = await app.inject({
      method: 'GET',
      url: '/api/v1/public/tournaments/challenge-u13-arve',
    });
    expect(
      detail.json().matches.find((m: { id: string }) => m.id === 'a6'),
    ).toMatchObject({
      status: 'FINISHED',
      scoreHome: 0,
      scoreAway: 0,
    });
  });

  it('refuse un but sans équipe', async () => {
    const { token } = await link('a6');
    const res = await send(token, {
      clientEventId: 'evt-goal-0009',
      type: 'GOAL',
      minute: 3,
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  const open = (token: string) =>
    app.inject({ method: 'GET', url: `/api/v1/reporter/${token}` });
  const goal = (id: string, side: 'home' | 'away', minute = 5) => ({
    clientEventId: id,
    type: 'GOAL',
    side,
    minute,
  });
  const score = async (code: string) => {
    const m = await prisma.match.findFirstOrThrow({
      where: { code, tournament: { slug: 'challenge-u13-arve' } },
    });
    return { home: m.scoreHome, away: m.scoreAway, status: m.status };
  };

  it('compte exactement des buts saisis en même temps', async () => {
    const { token } = await link('a6');
    const sides = ['home', 'away', 'home', 'home', 'away', 'home'] as const;
    const responses = await Promise.all(
      sides.map((side, i) => send(token, goal(`evt-par-000${i}`, side, i))),
    );
    expect(responses.map((r) => r.statusCode)).toEqual(sides.map(() => 200));
    // Chaque réponse voit un score différent : les saisies se sont suivies.
    const totals = responses.map((r) => {
      const s = r.json<{ score: { home: number; away: number } }>().score;
      return s.home + s.away;
    });
    expect(totals.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await score('a6')).toEqual({ home: 4, away: 2, status: 'LIVE' });
  });

  it('refuse toute saisie après la fin du match, sauf l’annulation de la fin', async () => {
    const { token } = await link('a6');
    await send(token, goal('evt-goal-0101', 'home', 3));
    const end = {
      clientEventId: 'evt-end-000102',
      type: 'FULL_TIME',
      minute: 20,
    };
    expect((await send(token, end)).json().status).toBe('FINISHED');

    const late = await send(token, goal('evt-goal-0103', 'away', 21));
    expect(late.statusCode).toBe(409);
    expect(late.headers['content-type']).toContain('application/problem+json');
    expect(late.json().detail ?? late.json().title).toMatch(/terminé/);
    const cancelGoal = await send(token, {
      clientEventId: 'evt-undo-0104',
      type: 'CANCEL',
      minute: 21,
      cancels: 'evt-goal-0101',
    });
    expect(cancelGoal.statusCode).toBe(409);
    // Renvoi identique de la fin : toujours idempotent après la fin.
    expect((await send(token, end)).statusCode).toBe(200);
    expect(await score('a6')).toEqual({ home: 1, away: 0, status: 'FINISHED' });

    // Fin sifflée par erreur : on l'annule, le match repart.
    const reopen = await send(token, {
      clientEventId: 'evt-undo-0105',
      type: 'CANCEL',
      minute: 20,
      cancels: 'evt-end-000102',
    });
    expect(reopen.json()).toEqual({
      score: { home: 1, away: 0 },
      status: 'LIVE',
    });
    expect(
      (await send(token, goal('evt-goal-0106', 'away', 22))).json(),
    ).toEqual({
      score: { home: 1, away: 1 },
      status: 'LIVE',
    });
  });

  it('refuse la saisie quand le tournoi n’est plus public', async () => {
    const { token } = await link('a6');
    await prisma.tournament.updateMany({
      where: { slug: 'challenge-u13-arve' },
      data: { status: 'ARCHIVED' },
    });
    const res = await send(token, goal('evt-goal-0201', 'home'));
    expect(res.statusCode).toBe(409);
    expect((await open(token)).statusCode).toBe(404);
    expect(await score('a6')).toEqual({
      home: 0,
      away: 0,
      status: 'SCHEDULED',
    });
  });

  it('refuse une annulation impossible', async () => {
    const { token } = await link('a6');
    const unknown = await send(token, {
      clientEventId: 'evt-undo-0301',
      type: 'CANCEL',
      minute: 2,
      cancels: 'evt-inconnu-01',
    });
    expect(unknown.statusCode).toBe(409);
    await send(token, goal('evt-goal-0302', 'home'));
    const undo = {
      clientEventId: 'evt-undo-0303',
      type: 'CANCEL',
      minute: 6,
      cancels: 'evt-goal-0302',
    };
    expect((await send(token, undo)).json().score).toEqual({
      home: 0,
      away: 0,
    });
    // Seconde annulation du même but, puis annulation d'une annulation.
    const twice = await send(token, {
      ...undo,
      clientEventId: 'evt-undo-0304',
    });
    expect(twice.statusCode).toBe(409);
    const ofCancel = await send(token, {
      clientEventId: 'evt-undo-0305',
      type: 'CANCEL',
      minute: 6,
      cancels: 'evt-undo-0303',
    });
    expect(ofCancel.statusCode).toBe(409);
    expect(
      await prisma.matchEvent.count({
        where: { clientEventId: { startsWith: 'evt-undo-030' } },
      }),
    ).toBe(1);
  });

  it('refuse un clientEventId réutilisé pour une autre saisie', async () => {
    const { token } = await link('a6');
    const first = goal('evt-goal-0401', 'home', 4);
    expect((await send(token, first)).statusCode).toBe(200);
    const identical = await send(token, first);
    expect(identical.statusCode).toBe(200);
    expect(identical.json().score).toEqual({ home: 1, away: 0 });
    const other = await send(token, { ...first, side: 'away' });
    expect(other.statusCode).toBe(409);
    expect((await send(token, { ...first, minute: 5 })).statusCode).toBe(409);
    expect(await score('a6')).toEqual({ home: 1, away: 0, status: 'LIVE' });
  });

  it('révoque les liens d’un match (dès bénévole)', async () => {
    const staff = await login(app, 'benevole@example.org');
    const { token } = await link('a6');
    const other = await link('a5');
    const revoke = (code: string, as: string) =>
      app.inject({
        method: 'DELETE',
        url: `/api/v1/organizer/tournaments/challenge-u13-arve/matches/${code}/reporter-links`,
        headers: { authorization: `Bearer ${as}` },
      });
    expect((await revoke('a6', staff)).statusCode).toBe(204);
    expect((await open(token)).statusCode).toBe(404);
    expect((await send(token, goal('evt-goal-0501', 'home'))).statusCode).toBe(
      404,
    );
    // Les autres matchs gardent leur lien ; un nouveau lien rouvre le match.
    expect((await open(other.token)).statusCode).toBe(200);
    expect((await open((await link('a6')).token)).statusCode).toBe(200);
    expect((await revoke('zz9', staff)).statusCode).toBe(404);
    const otherClub = await app.inject({
      method: 'DELETE',
      url: '/api/v1/organizer/tournaments/coupe-noel-u11-bonneville/matches/a1/reporter-links',
      headers: { authorization: `Bearer ${staff}` },
    });
    expect(otherClub.statusCode).toBe(404);
  });

  it('coupe les liens d’un membre retiré du club', async () => {
    const staff = await login(app, 'benevole@example.org');
    const own = await link('a6', staff);
    const kept = await link('a6');
    expect((await open(own.token)).statusCode).toBe(200);
    const hugo = await prisma.user.findUniqueOrThrow({
      where: { email: 'benevole@example.org' },
    });
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizer/members/${hugo.id}`,
      headers: { authorization: `Bearer ${ORGANIZER_TOKEN}` },
    });
    expect(removed.statusCode).toBe(204);
    expect((await open(own.token)).statusCode).toBe(404);
    expect(
      (await send(own.token, goal('evt-goal-0601', 'home'))).statusCode,
    ).toBe(404);
    // Le lien émis par la propriétaire continue de fonctionner.
    expect(
      (await send(kept.token, goal('evt-goal-0602', 'home'))).statusCode,
    ).toBe(200);
  });

  it('refuse un lien expiré en base ou un jeton modifié', async () => {
    const { token } = await link('a6');
    const [id, exp, signature] = token.split('.') as [string, string, string];
    expect(
      (await open(`${id}.${Number(exp) + 3600}.${signature}`)).statusCode,
    ).toBe(404);
    expect((await open(`${id}x.${exp}.${signature}`)).statusCode).toBe(404);
    await prisma.reporterLink.update({
      where: { id },
      data: { expiresAt: new Date('2026-11-09T09:00:00Z') },
    });
    expect((await open(token)).statusCode).toBe(404);
    expect((await send(token, goal('evt-goal-0701', 'home'))).statusCode).toBe(
      404,
    );
  });

  it('plafonne les notifications de but et nettoie le nom du buteur', async () => {
    const notify = vi.spyOn(app.get(PushService), 'notify');
    try {
      const { token } = await link('a6');
      await send(token, {
        ...goal('evt-goal-0801', 'home', 3),
        player: ' T.\u202e  Roux\u0007 ',
      });
      await send(token, goal('evt-goal-0802', 'away', 4));
      await send(token, goal('evt-goal-0803', 'home', 5));
      // Horloge figée : les buts 2 et 3 tombent dans les 20 secondes du premier.
      const goals = notify.mock.calls.filter(([n]) => n.kind === 'goal');
      expect(goals).toHaveLength(1);
      expect(goals[0]![0].body).toContain('· T. Roux');
      const end = await send(token, {
        clientEventId: 'evt-end-000804',
        type: 'FULL_TIME',
        minute: 20,
      });
      expect(end.json().score).toEqual({ home: 2, away: 1 });
      expect(notify.mock.calls.at(-1)![0]).toMatchObject({ kind: 'result' });
      const feed = await app.inject({
        method: 'GET',
        url: '/api/v1/public/tournaments/challenge-u13-arve/matches/a6/feed',
      });
      expect(
        feed.json().events.filter((e: { type: string }) => e.type === 'GOAL'),
      ).toHaveLength(3);
      expect(
        feed.json().events.find((e: { player?: string }) => e.player),
      ).toMatchObject({ player: 'T. Roux' });
    } finally {
      notify.mockRestore();
    }
  });
});
