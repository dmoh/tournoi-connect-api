import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import { ConvocationsService } from '../src/convocations/convocations.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

/** Tournoi de la démo rendu gratuit : une inscription y est confirmée tout de suite. */
const SLUG = 'coupe-noel-u11-bonneville';
const HOUR = 60 * 60_000;

describe('Convocations des équipes (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let convocations: ConvocationsService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
    convocations = app.get(ConvocationsService);
  });
  beforeEach(async () => {
    await reset();
    mailbox.length = 0;
  });
  afterAll(() => app.close());

  /** Léa inscrit « Les Aigles » ; le tournoi commence dans `hours` heures. */
  async function registeredTeam(hours: number) {
    const tournament = await prisma.tournament.update({
      where: { slug: SLUG },
      data: {
        startsAt: new Date(DEMO_NOW.getTime() + hours * HOUR),
        endsAt: new Date(DEMO_NOW.getTime() + (hours + 6) * HOUR),
        status: 'REGISTRATION_OPEN',
        registrationDeadline: null,
        feeCents: 0,
      },
    });
    const token = await login(app, 'lea@example.com');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${SLUG}/registrations`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomBytes(8).toString('hex'),
      },
      payload: {
        teamName: 'Les Aigles',
        club: '',
        managerName: 'Léa',
        phone: '06 12 34 56 78',
        players: [{ firstName: 'Tom', lastName: 'Roux', number: '9' }],
        acceptRules: true,
      },
    });
    expect(response.json(), response.body).toMatchObject({
      status: 'CONFIRMED',
    });
    const registration = await prisma.registration.findUniqueOrThrow({
      where: { id: response.json<{ orderId: string }>().orderId },
      include: { team: true },
    });
    return {
      tournament,
      token,
      team: registration.team!,
      orderId: registration.id,
    };
  }

  const convocationsTo = (email: string) =>
    mailbox.filter(
      (m) => m.to === email && m.subject.startsWith('Convocation'),
    );

  it('convoque 48 h avant un tournoi tiré au sort, une seule fois, avec le premier match', async () => {
    const { tournament, team } = await registeredTeam(40);
    await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        code: 'a1',
        phase: 'groups',
        group: 'A',
        field: 'Terrain 2',
        startsAt: tournament.startsAt,
        homeTeamCode: team.code,
        awayTeamCode: null,
        awayPlaceholder: '2e poule B',
      },
    });

    expect(await convocations.sweep()).toBe(1);
    const [mail] = convocationsTo('lea@example.com');
    expect(mail?.subject).toBe(
      `Convocation : Les Aigles au ${tournament.name}, ${new Intl.DateTimeFormat(
        'fr-FR',
        {
          timeZone: 'Europe/Paris',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        },
      ).format(tournament.startsAt)}`,
    );
    expect(mail?.text).toMatch(/\d+ h \d{2} · Terrain 2 · contre 2e poule B/);
    expect(mail?.text).toContain(`/t/${SLUG}/agenda?team=${team.code}`);
    expect(mail?.text).toContain(
      'https://www.google.com/maps/dir/?api=1&destination=',
    );

    // Le balayage suivant n'envoie rien de plus.
    expect(await convocations.sweep()).toBe(0);
    expect(convocationsTo('lea@example.com')).toHaveLength(1);
  });

  it('renvoie seul les convocations quand le calendrier change, une fois les changements finis', async () => {
    const { tournament } = await registeredTeam(40);
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        convocationsSentAt: new Date(DEMO_NOW.getTime() - 2 * HOUR),
        // Planning encore modifié il y a 10 minutes : on attend.
        scheduleChangedAt: new Date(DEMO_NOW.getTime() - 10 * 60_000),
      },
    });
    expect(await convocations.sweep()).toBe(0);
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { scheduleChangedAt: new Date(DEMO_NOW.getTime() - HOUR) },
    });
    expect(await convocations.sweep()).toBe(1);
    expect(
      mailbox.filter((m) =>
        m.subject.startsWith('Horaires modifiés : Les Aigles'),
      ),
    ).toHaveLength(1);
    expect(await convocations.sweep()).toBe(0);
  });

  it('sans tirage, attend 24 h avant le début, puis convoque avec l’heure de début', async () => {
    await registeredTeam(40);
    expect(await convocations.sweep()).toBe(0);
    await prisma.tournament.update({
      where: { slug: SLUG },
      data: { startsAt: new Date(DEMO_NOW.getTime() + 20 * HOUR) },
    });
    expect(await convocations.sweep()).toBe(1);
    expect(convocationsTo('lea@example.com')[0]?.text).toContain(
      'Début du tournoi',
    );
  });

  it('le club voit l’échéance et peut envoyer tout de suite, de nouveau', async () => {
    const { tournament } = await registeredTeam(100);
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { organization: { connect: { slug: 'etoile-de-l-arve' } } },
    });
    const owner = await login(app);
    const url = `/api/v1/organizer/tournaments/${SLUG}/convocations`;
    const headers = {
      authorization: `Bearer ${owner}`,
      'x-organization': 'etoile-de-l-arve',
    };

    const before = await app.inject({ method: 'GET', url, headers });
    expect(before.json()).toMatchObject({
      sentAt: null,
      scheduledAt: new Date(
        DEMO_NOW.getTime() + (100 - 24) * HOUR,
      ).toISOString(),
      recipients: 1,
      sendable: true,
    });
    const send = () =>
      app.inject({
        method: 'POST',
        url,
        headers: {
          ...headers,
          'idempotency-key': randomBytes(8).toString('hex'),
        },
      });
    expect((await send()).json()).toMatchObject({
      sentAt: DEMO_NOW.toISOString(),
    });
    expect((await send()).statusCode).toBe(200);
    expect(convocationsTo('lea@example.com')).toHaveLength(2);

    const staff = await login(app, 'benevole@example.org');
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { ...headers, authorization: `Bearer ${staff}` },
        })
      ).statusCode,
    ).toBe(404);
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { status: 'CANCELLED' },
    });
    expect((await send()).statusCode).toBe(409);
  });

  it('sert le calendrier de l’équipe en iCalendar, mis à jour avec les horaires', async () => {
    const { tournament, team, token, orderId } = await registeredTeam(40);
    const ics = () =>
      app.inject({
        method: 'GET',
        url: `/api/v1/public/tournaments/${SLUG}/calendar.ics?team=${team.code}`,
      });

    // Pas encore de match : le tournoi entier.
    const before = await ics();
    expect(before.statusCode).toBe(200);
    expect(before.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(before.body).toContain(`SUMMARY:${tournament.name}`);
    expect(before.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);

    await prisma.match.createMany({
      data: [1, 2].map((n) => ({
        tournamentId: tournament.id,
        code: `a${n}`,
        phase: 'groups' as const,
        group: 'A',
        field: `Terrain ${n}`,
        startsAt: new Date(tournament.startsAt.getTime() + n * HOUR),
        homeTeamCode: team.code,
        awayPlaceholder: `Équipe ${n}`,
      })),
    });
    const after = (await ics()).body;
    expect(after.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(after).toContain('SUMMARY:Les Aigles – Équipe 1');
    expect(after).toContain('(Terrain 2)');

    // Mes équipes donne le lien, l'équipe inconnue répond 404.
    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/registrations/${orderId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mine.json().teamCode).toBe(team.code);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/public/tournaments/${SLUG}/calendar.ics?team=inconnue`,
        })
      ).statusCode,
    ).toBe(404);
  });
});
