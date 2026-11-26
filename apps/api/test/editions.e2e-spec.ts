import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import type { PrismaService } from '../src/database/prisma.service.js';
import { createTestApp, login, mailbox } from './setup-app.js';

/** Tournoi du club de démonstration (Étoile de l'Arve), le 9 novembre 2026. */
const SLUG = 'challenge-u13-arve';
const CLUB = 'etoile-de-l-arve';

describe('Édition suivante (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let owner: string;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
  });
  beforeEach(async () => {
    await reset();
    owner = await login(app);
    mailbox.length = 0;
  });
  afterAll(() => app.close());

  const organizer = (
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    as = owner,
  ) =>
    app.inject({
      method,
      url: `/api/v1/organizer${url}`,
      headers: {
        authorization: `Bearer ${as}`,
        'x-organization': CLUB,
        ...(method === 'POST'
          ? { 'idempotency-key': randomBytes(8).toString('hex') }
          : {}),
      },
      ...(payload ? { payload } : {}),
    });

  /** Équipe inscrite et confirmée par `email` au tournoi de démonstration. */
  async function confirmed(email: string, teamName: string) {
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    const manager = await prisma.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    await prisma.registration.create({
      data: {
        tournamentId: tournament.id,
        managerId: manager.id,
        teamName,
        club: 'Club',
        managerName: 'Camille',
        phone: '0612345678',
        players: [],
        status: 'CONFIRMED',
        feeCents: 0,
        serviceFeeCents: 0,
        totalCents: 0,
        idempotencyKey: randomBytes(8).toString('hex'),
      },
    });
  }

  it('prépare l’édition suivante : mêmes réglages, 52 semaines plus tard, même jour', async () => {
    await confirmed('aigles@example.org', 'Les Aigles');
    await confirmed('AIGLES@example.org', 'Les Aigles B');
    await confirmed('marmottes@example.org', 'Les Marmottes');

    const res = await organizer('GET', `/tournaments/${SLUG}/next-edition`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const source = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
      include: { venue: true },
    });
    expect(body.draft).toMatchObject({
      name: source.name,
      sport: source.sport,
      venueName: source.venue.name,
      city: source.venue.city,
      fields: source.fieldCount,
      maxTeams: source.maxTeams,
      matchMinutes: source.matchMinutes,
    });
    // 9 novembre 2026, un lundi → 8 novembre 2027, un lundi ; même heure de Paris.
    const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
    expect(day(body.draft.date)).toBe(day('2026-11-09'));
    expect(body.draft.date).toBe('2027-11-08');
    expect(body.draft.registrationDeadline <= body.draft.date).toBe(true);
    // Deux inscriptions de la même adresse (casse comprise) : un seul email.
    expect(body.previous).toEqual({ slug: SLUG, name: source.name, teams: 2 });
  });

  it('publie l’édition suivante et invite une seule fois les équipes de la précédente', async () => {
    await confirmed('aigles@example.org', 'Les Aigles');
    const { draft } = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    const created = await organizer('POST', '/tournaments', {
      ...draft,
      name: 'Challenge U13 de l’Arve 2027',
      previousEdition: { slug: SLUG, inviteTeams: true },
    });
    expect(created.statusCode).toBe(201);
    const next = await prisma.tournament.findUniqueOrThrow({
      where: { slug: created.json().slug },
      include: { previousEdition: { select: { slug: true } } },
    });
    expect(next.previousEdition?.slug).toBe(SLUG);
    expect(next.editionInvitesSentAt).not.toBeNull();
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]).toMatchObject({
      to: 'aigles@example.org',
      subject: 'Challenge U13 de l’Arve 2027 : les inscriptions sont ouvertes',
    });
    expect(mailbox[0]!.text).toContain(`/join/${next.slug}`);

    // Une autre édition préparée depuis le même tournoi n'écrit plus à personne.
    mailbox.length = 0;
    const again = await organizer('POST', '/tournaments', {
      ...draft,
      name: 'Challenge U13 de l’Arve bis',
      previousEdition: { slug: SLUG, inviteTeams: true },
    });
    expect(again.statusCode).toBe(201);
    expect(mailbox).toHaveLength(0);
  });

  it('sans invitation cochée, l’édition est liée mais personne n’est prévenu', async () => {
    await confirmed('aigles@example.org', 'Les Aigles');
    const { draft } = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    const created = await organizer('POST', '/tournaments', {
      ...draft,
      previousEdition: { slug: SLUG, inviteTeams: false },
    });
    expect(created.statusCode).toBe(201);
    expect(mailbox).toHaveLength(0);
  });

  it('un tournoi d’un autre club répond 404, et un bénévole ne prépare rien', async () => {
    const other = 'tournoi-11-novembre-u15';
    expect(
      (await organizer('GET', `/tournaments/${other}/next-edition`)).statusCode,
    ).toBe(404);
    const { draft } = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    expect(
      (
        await organizer('POST', '/tournaments', {
          ...draft,
          previousEdition: { slug: other, inviteTeams: true },
        })
      ).statusCode,
    ).toBe(404);
    const staff = await login(app, 'benevole@example.org');
    expect(
      (
        await organizer(
          'GET',
          `/tournaments/${SLUG}/next-edition`,
          undefined,
          staff,
        )
      ).statusCode,
    ).toBe(404);
  });
});
