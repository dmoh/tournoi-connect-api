import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PrismaService } from '../src/database/prisma.service.js';
import { SponsorReportsService } from '../src/reports/sponsor-reports.service.js';
import { DEMO_NOW, createTestApp, mailbox } from './setup-app.js';

/** Tournoi du club de démonstration, avec ses partenaires et leur audience. */
const SLUG = 'challenge-u13-arve';
const HOUR = 60 * 60_000;

describe('Bilan des partenaires (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let reports: SponsorReportsService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    reset = ctx.reset;
    reports = app.get(SponsorReportsService);
  });
  beforeEach(async () => {
    await reset();
    mailbox.length = 0;
  });
  afterAll(() => app.close());

  /** Tournoi terminé depuis `hours` heures, un partenaire payé avec une adresse. */
  async function endedSince(hours: number, email = 'partenaire@example.org') {
    const t = await prisma.tournament.update({
      where: { slug: SLUG },
      data: { endsAt: new Date(DEMO_NOW.getTime() - hours * HOUR) },
    });
    const paid = await prisma.tournamentSponsor.findFirstOrThrow({
      where: { tournamentId: t.id, status: 'PAID' },
    });
    await prisma.sponsor.update({
      where: { id: paid.sponsorId },
      data: { email },
    });
    return { t, paid };
  }

  it('le lendemain du tournoi, chaque partenaire reçoit son bilan, une seule fois', async () => {
    const { paid } = await endedSince(13);
    expect(await reports.sweep()).toBeGreaterThan(0);
    const mail = mailbox.find((m) => m.to === 'partenaire@example.org')!;
    expect(mail.subject).toMatch(/Votre partenariat au « .+ » en chiffres/);
    expect(mail.text).toMatch(/\d+\saffichages? · \d+\sclics?/);
    expect(mail.text).toContain(`/bilan/${paid.reportToken}`);
    expect(mail.text).toContain('/editions/desinscription/');
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
    expect(
      (
        await prisma.tournamentSponsor.findUniqueOrThrow({
          where: { id: paid.id },
        })
      ).reportSentAt,
    ).not.toBeNull();

    // Second passage : rien de plus.
    mailbox.length = 0;
    await reports.sweep();
    expect(
      mailbox.filter((m) => m.to === 'partenaire@example.org'),
    ).toHaveLength(0);
  });

  it('pas avant le lendemain', async () => {
    await endedSince(2);
    await reports.sweep();
    expect(
      mailbox.filter((m) => m.to === 'partenaire@example.org'),
    ).toHaveLength(0);
  });

  it('un partenaire désinscrit des sollicitations du club ne reçoit pas de bilan', async () => {
    const { t } = await endedSince(13, 'desinscrit@example.org');
    await prisma.editionInvite.create({
      data: {
        organizationId: t.organizationId,
        tournamentId: t.id,
        email: 'desinscrit@example.org',
        optedOutAt: new Date(),
      },
    });
    await reports.sweep();
    expect(
      mailbox.filter((m) => m.to === 'desinscrit@example.org'),
    ).toHaveLength(0);
  });

  it('la page de bilan, sans connexion : chiffres par emplacement, et 404 pour un lien inconnu', async () => {
    const { paid } = await endedSince(13);
    const audience = await prisma.audienceHourly.aggregate({
      where: { tournamentSponsorId: paid.id },
      _sum: { impressions: true, clicks: true },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/sponsor-reports/${paid.reportToken}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tournament: { slug: SLUG },
      impressions: audience._sum.impressions ?? 0,
      clicks: audience._sum.clicks ?? 0,
    });
    expect(Array.isArray(res.json().placements)).toBe(true);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/public/sponsor-reports/inconnu',
        })
      ).statusCode,
    ).toBe(404);
  });
});
