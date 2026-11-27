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
    expect(body.previous).toMatchObject({
      slug: SLUG,
      name: source.name,
      startsAt: source.startsAt.toISOString(),
      teams: 2,
      invited: false,
    });
    expect(body.existing).toBeNull();
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
      subject: expect.stringMatching(
        /^Étoile de l.Arve – Challenge U13 de l’Arve 2027\u202f: inscriptions ouvertes$/,
      ),
    });
    expect(mailbox[0]!.text).toContain(`/join/${next.slug}`);
    // Envoyé un an à l'avance : la date porte l'année.
    expect(mailbox[0]!.text).toContain('lundi 8 novembre 2027');
    expect(mailbox[0]!.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );

    // Le tournoi source montre l'édition suivante et l'invitation déjà faite.
    const again0 = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    expect(again0.previous.invited).toBe(true);
    expect(again0.existing).toMatchObject({ slug: next.slug });
    const list = (await organizer('GET', '/tournaments')).json();
    expect(
      list.items.find((t: { slug: string }) => t.slug === SLUG).nextEdition,
    ).toMatchObject({ slug: next.slug });

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

  it('se désinscrire d’un appui (ou d’un clic du client mail) : le club n’écrit plus', async () => {
    await confirmed('aigles@example.org', 'Les Aigles');
    const { draft } = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    const created = await organizer('POST', '/tournaments', {
      ...draft,
      previousEdition: { slug: SLUG, inviteTeams: true },
    });
    const invite = await prisma.editionInvite.findFirstOrThrow({
      where: { tournament: { slug: created.json().slug } },
    });
    expect(mailbox[0]!.text).toContain(
      `/editions/desinscription/${invite.token}`,
    );

    const url = `/api/v1/public/edition-invites/${invite.token}`;
    expect((await app.inject({ method: 'GET', url })).json()).toEqual({
      club: expect.stringMatching(/^Étoile de l.Arve$/),
      optedOut: false,
    });
    // Désinscription en un clic : POST en formulaire, comme Gmail ou Apple Mail.
    const oneClick = await app.inject({
      method: 'POST',
      url: `${url}/opt-out`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(oneClick.statusCode).toBe(200);
    expect(oneClick.json().optedOut).toBe(true);
    // Rejouer ne change rien.
    expect(
      (await app.inject({ method: 'POST', url: `${url}/opt-out` })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/public/edition-invites/inconnu',
        })
      ).statusCode,
    ).toBe(404);

    // L'adresse désinscrite n'est plus comptée ni invitée par le club.
    const after = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    expect(after.previous.teams).toBe(0);
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

  it('reprend les packs et propose aux partenaires de renouveler, une seule fois', async () => {
    const source = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
      include: { packages: true },
    });
    // Partenaires payés de l'édition, avec une adresse.
    const paid = await prisma.tournamentSponsor.findMany({
      where: { tournamentId: source.id, status: 'PAID' },
      include: { sponsor: true },
    });
    expect(paid.length).toBeGreaterThan(0);
    await prisma.sponsor.update({
      where: { id: paid[0]!.sponsorId },
      data: { email: 'partenaire@example.org' },
    });
    // Un partenaire par sponsor (son pack le plus haut).
    const withEmail = new Set(
      (
        await prisma.tournamentSponsor.findMany({
          where: {
            tournamentId: source.id,
            status: 'PAID',
            sponsor: { email: { not: null } },
          },
          select: { sponsorId: true },
        })
      ).map((r) => r.sponsorId),
    ).size;

    const next = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    expect(next.previous).toMatchObject({
      sponsors: withEmail,
      sponsorsRenewed: false,
    });
    expect(next.previous.packages).toHaveLength(source.packages.length);
    // Qui reçoit quoi, à quel prix (frais compris) : un pack par partenaire.
    expect(next.previous.partners).toHaveLength(withEmail);
    expect(next.previous.partners[0]).toMatchObject({
      name: expect.any(String),
      tier: expect.stringMatching(/GOLD|SILVER|BRONZE|FIELD/),
      totalCents: expect.any(Number),
    });

    const created = await organizer('POST', '/tournaments', {
      ...next.draft,
      previousEdition: { slug: SLUG, inviteTeams: false, renewSponsors: true },
    });
    expect(created.statusCode).toBe(201);
    const edition = await prisma.tournament.findUniqueOrThrow({
      where: { slug: created.json().slug },
      include: { packages: true, sponsors: true },
    });
    // Mêmes packs, mêmes prix.
    expect(
      edition.packages.map((p) => [p.tier, p.priceCents, p.inventory]).sort(),
    ).toEqual(
      source.packages.map((p) => [p.tier, p.priceCents, p.inventory]).sort(),
    );
    // Partenaires invités (dans la limite des packs), lien de paiement par email.
    expect(edition.sponsors.length).toBeGreaterThan(0);
    expect(edition.sponsors.every((r) => r.status === 'INVITED')).toBe(true);
    expect(edition.sponsorRenewalsSentAt).not.toBeNull();
    expect(mailbox.some((m) => m.to === 'partenaire@example.org')).toBe(true);
    const renewal = mailbox.find((m) => m.to === 'partenaire@example.org')!;
    // Email du partenaire de l'an dernier : remerciement, même pack, désinscription.
    expect(renewal.subject).toMatch(/renouveler votre/);
    expect(renewal.text).toContain('Merci d’avoir soutenu');
    expect(renewal.text).toContain('/sponsor/');
    expect(renewal.text).toContain('/editions/desinscription/');
    expect(renewal.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );

    // Une autre édition depuis le même tournoi : packs repris, plus de relance.
    mailbox.length = 0;
    const again = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    expect(again.previous.sponsorsRenewed).toBe(true);
    const bis = await organizer('POST', '/tournaments', {
      ...next.draft,
      name: 'Challenge bis',
      previousEdition: { slug: SLUG, inviteTeams: false, renewSponsors: true },
    });
    expect(bis.statusCode).toBe(201);
    expect(mailbox).toHaveLength(0);
  });

  it('un partenaire désinscrit n’est plus relancé par le club', async () => {
    const source = await prisma.tournament.findUniqueOrThrow({
      where: { slug: SLUG },
    });
    const paid = await prisma.tournamentSponsor.findFirstOrThrow({
      where: { tournamentId: source.id, status: 'PAID' },
    });
    await prisma.sponsor.update({
      where: { id: paid.sponsorId },
      data: { email: 'desinscrit@example.org' },
    });
    const before = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    await prisma.editionInvite.create({
      data: {
        organizationId: source.organizationId,
        tournamentId: source.id,
        email: 'desinscrit@example.org',
        optedOutAt: new Date(),
      },
    });
    const after = (
      await organizer('GET', `/tournaments/${SLUG}/next-edition`)
    ).json();
    expect(after.previous.sponsors).toBe(before.previous.sponsors - 1);
  });
});
