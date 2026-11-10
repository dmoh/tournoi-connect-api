import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  DEMO_ACCOUNTS,
  DEMO_MATCH_EVENTS,
  DEMO_MATCHES,
  DEMO_ORGANIZATIONS,
  DEMO_PACKAGES,
  DEMO_PLAYERS,
  DEMO_POSTS,
  DEMO_REACTIONS,
  DEMO_SPONSORS,
  DEMO_TEAMS,
  DEMO_TOURNAMENTS,
  DEMO_VENUES,
  LIVE_SLUG,
} from './demo-data.js';

/**
 * Remplace le contenu de la base par les données de démonstration.
 * Rejouable à l'identique (local, homologation, tests e2e) ; jamais en
 * production.
 */
export async function seedDemo(prisma: PrismaClient): Promise<void> {
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany({
    where: { email: { endsWith: '@example.org' } },
  });
  await prisma.loginCode.deleteMany({
    where: { email: { endsWith: '@example.org' } },
  });

  const organizations = new Map<string, string>();
  for (const org of DEMO_ORGANIZATIONS) {
    const created = await prisma.organization.create({ data: org });
    organizations.set(org.slug, created.id);
  }

  const tournaments = new Map<string, { id: string; organizationId: string }>();
  for (const t of DEMO_TOURNAMENTS) {
    const organizationId = organizations.get(t.organization)!;
    const venue = DEMO_VENUES.find((v) => v.key === t.venue)!;
    const { key: _key, ...venueData } = venue;
    const created = await prisma.tournament.create({
      data: {
        slug: t.slug,
        name: t.name,
        sport: t.sport,
        startsAt: new Date(t.startsAt),
        endsAt: new Date(t.endsAt),
        categories: t.categories,
        teamCount: t.teamCount,
        maxTeams: t.maxTeams,
        feeCents: t.feeCents,
        status: t.status,
        organization: { connect: { id: organizationId } },
        venue: { create: { ...venueData, organizationId } },
      },
    });
    tournaments.set(t.slug, { id: created.id, organizationId });
  }

  const live = tournaments.get(LIVE_SLUG)!;
  await prisma.team.createMany({
    data: DEMO_TEAMS.map((team) => ({
      ...team,
      club: team.name,
      tournamentId: live.id,
    })),
  });
  const teamIds = new Map(
    (
      await prisma.team.findMany({
        where: { tournamentId: live.id },
        select: { id: true, code: true },
      })
    ).map((t) => [t.code, t.id]),
  );
  await prisma.player.createMany({
    data: DEMO_PLAYERS.map(({ team, ...player }) => ({
      ...player,
      teamId: teamIds.get(team)!,
    })),
  });
  await prisma.match.createMany({
    data: DEMO_MATCHES.map(({ time, home, away, ...match }) => ({
      ...match,
      tournamentId: live.id,
      startsAt: new Date(`2026-11-09T${time}:00+01:00`),
      homeTeamCode: home ?? null,
      awayTeamCode: away ?? null,
    })),
  });
  const matchIds = new Map(
    (
      await prisma.match.findMany({
        where: { tournamentId: live.id },
        select: { id: true, code: true },
      })
    ).map((m) => [m.code, m.id]),
  );
  await prisma.matchEvent.createMany({
    data: DEMO_MATCH_EVENTS.map(({ match, at, ...event }, index) => ({
      ...event,
      matchId: matchIds.get(match)!,
      clientEventId: `demo-${index + 1}`,
      createdAt: new Date(`2026-11-09T${at}+01:00`),
    })),
  });
  let device = 0;
  await prisma.matchReaction.createMany({
    data: Object.entries(DEMO_REACTIONS.counts).flatMap(([kind, count]) =>
      Array.from({ length: count }, () => ({
        matchId: matchIds.get(DEMO_REACTIONS.match)!,
        kind: kind as keyof typeof DEMO_REACTIONS.counts,
        deviceId: `00000000-0000-4000-8000-${String(++device).padStart(12, '0')}`,
      })),
    ),
  });
  for (const { options, publishedAt, ...post } of DEMO_POSTS) {
    await prisma.post.create({
      data: {
        ...post,
        tournamentId: live.id,
        publishedAt: new Date(publishedAt),
        options: options
          ? {
              create: options.map((label, position) => ({
                label,
                position,
                votes: 3 - position,
              })),
            }
          : undefined,
      },
    });
  }

  await prisma.sponsorPackage.createMany({
    data: DEMO_PACKAGES.map((pack) => ({ ...pack, tournamentId: live.id })),
  });
  for (const [
    index,
    { status, tier, field, ...sponsor },
  ] of DEMO_SPONSORS.entries()) {
    await prisma.sponsor.create({
      data: {
        ...sponsor,
        organizationId: live.organizationId,
        tournaments:
          status && tier
            ? {
                create: {
                  tournamentId: live.id,
                  status,
                  tier,
                  field: field ?? null,
                  invitedAt: new Date('2026-10-20T10:00:00+02:00'),
                  paidAt:
                    status === 'PAID'
                      ? new Date('2026-10-25T10:00:00+02:00')
                      : null,
                  // Audience de la matinée : base des statistiques de l'écran Sponsors.
                  audience:
                    status === 'PAID'
                      ? {
                          create: [9, 10].map((hour) => ({
                            placement:
                              tier === 'GOLD'
                                ? 'BANNER_EXCLUSIVE'
                                : tier === 'FIELD'
                                  ? 'FIELD_LOGO'
                                  : 'BANNER_ROTATION',
                            hourBucket: new Date(
                              `2026-11-09T${String(hour).padStart(2, '0')}:00:00+01:00`,
                            ),
                            impressions: 120 - index * 10 + hour,
                            clicks: 6 - Math.min(index, 5),
                          })),
                        }
                      : undefined,
                },
              }
            : undefined,
      },
    });
  }

  for (const { memberships, sponsor, ...account } of DEMO_ACCOUNTS) {
    const sponsorId = sponsor
      ? (
          await prisma.sponsor.findFirst({
            where: { name: sponsor },
            select: { id: true },
          })
        )?.id
      : undefined;
    await prisma.user.create({
      data: {
        ...account,
        identities: { create: { provider: 'EMAIL', subject: account.email } },
        ...(memberships
          ? {
              memberships: {
                create: memberships.map(({ organization, role }) => ({
                  role,
                  organizationId: organizations.get(organization)!,
                })),
              },
            }
          : {}),
        ...(sponsorId ? { sponsorAccess: { create: { sponsorId } } } : {}),
      },
    });
  }
}

// Lancé directement : pnpm db:seed (après pnpm build).
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL manque.');
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'Le jeu de démonstration ne se charge jamais en production.',
    );
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  await seedDemo(prisma);
  await prisma.$disconnect();
  console.log('Données de démonstration chargées.');
}
