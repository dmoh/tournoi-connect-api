import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { TeamRecapsService } from '../src/reports/team-recaps.service.js';
import { DEMO_NOW, createTestApp, login, mailbox } from './setup-app.js';

/** Tournoi du club de démonstration, avec ses équipes et ses matchs joués. */
const SLUG = 'challenge-u13-arve';
const HOUR = 60 * 60_000;
const MANAGER = 'lea@example.com';

describe('Récapitulatif des équipes (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let recaps: TeamRecapsService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
    recaps = app.get(TeamRecapsService);
  });
  beforeEach(async () => {
    await reset();
    mailbox.length = 0;
  });
  afterAll(() => app.close());

  /**
   * Tournoi terminé depuis `hours` heures ; Léa est la responsable d'une
   * équipe qui a joué (inscription confirmée).
   */
  async function finishedSince(hours: number, status = 'COMPLETED' as const) {
    const t = await prisma.tournament.update({
      where: { slug: SLUG },
      data: {
        status,
        endsAt: new Date(DEMO_NOW.getTime() - hours * HOUR),
      },
      include: { matches: true },
    });
    const played = t.matches.find((m) => m.status === 'FINISHED')!;
    const team = await prisma.team.findFirstOrThrow({
      where: { tournamentId: t.id, code: played.homeTeamCode! },
    });
    await login(app, MANAGER);
    const manager = await prisma.user.findUniqueOrThrow({
      where: { email: MANAGER },
    });
    await prisma.registration.deleteMany({ where: { teamId: team.id } });
    const registration = await prisma.registration.create({
      data: {
        tournamentId: t.id,
        managerId: manager.id,
        teamName: team.name,
        club: team.club,
        managerName: 'Léa',
        phone: '06 12 34 56 78',
        players: [],
        status: 'CONFIRMED',
        feeCents: 0,
        serviceFeeCents: 0,
        totalCents: 0,
        idempotencyKey: randomBytes(8).toString('hex'),
        teamId: team.id,
      },
    });
    mailbox.length = 0;
    return { t, team, registration };
  }

  const toManager = () => mailbox.filter((m) => m.to === MANAGER);

  it('le lendemain d’un tournoi terminé, chaque équipe reçoit son récapitulatif, une seule fois', async () => {
    const { t, team, registration } = await finishedSince(13);
    expect(await recaps.sweep()).toBeGreaterThan(0);
    const [mail] = toManager();
    expect(mail?.subject).toContain(team.name);
    expect(mail?.text).toMatch(
      /\d+\svictoires?, .*\d+\sdéfaites? · \d+\sbuts? marqués?/,
    );
    expect(mail?.text).toContain(`/t/${SLUG}/palmares`);
    expect(mail?.text).toContain('/editions/desinscription/');
    expect(mail?.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: registration.id },
        })
      ).recapSentAt,
    ).not.toBeNull();

    // Second passage : rien de plus.
    mailbox.length = 0;
    await recaps.sweep();
    expect(toManager()).toHaveLength(0);

    // Le club voit que c'est fait.
    const token = await login(app);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/organizer/tournaments?limit=50',
      headers: { authorization: `Bearer ${token}` },
    });
    const row = list
      .json<{
        items: { slug: string; teamRecapsSentAt?: string | null }[];
      }>()
      .items.find((r) => r.slug === t.slug);
    expect(row?.teamRecapsSentAt).toEqual(expect.any(String));
  });

  it('pas avant le lendemain, ni pour un tournoi qui n’est pas terminé', async () => {
    await finishedSince(2);
    await recaps.sweep();
    expect(toManager()).toHaveLength(0);

    await finishedSince(13, 'IN_PROGRESS' as 'COMPLETED');
    await recaps.sweep();
    expect(toManager()).toHaveLength(0);
  });

  it('un responsable désinscrit des sollicitations du club ne reçoit rien', async () => {
    const { t } = await finishedSince(13);
    await prisma.editionInvite.create({
      data: {
        organizationId: t.organizationId,
        tournamentId: t.id,
        email: MANAGER,
        optedOutAt: new Date(),
      },
    });
    await recaps.sweep();
    expect(toManager()).toHaveLength(0);
  });
});
