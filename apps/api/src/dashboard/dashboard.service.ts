import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import { StripeClient } from '../payments/stripe-client.js';
import { STRIPE } from '../registrations/registrations.tokens.js';
import { euros, toCsv } from './csv.js';
import type { Dashboard, DashboardTournament } from './dashboard.schemas.js';

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmée',
  PENDING_PAYMENT: 'Paiement en cours',
  WAITLISTED: 'Liste d’attente',
  EXPIRED: 'Paiement expiré',
  CANCELLED: 'Annulée',
};

const DATE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

interface PlayerEntry {
  firstName?: string;
  lastName?: string;
  number?: string | number;
}

/**
 * Pilotage du club : remplissage et encaissements de chaque tournoi,
 * audience des sponsors, solde et versements Stripe, exports CSV pour le
 * secrétariat (inscriptions, effectifs).
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(STRIPE) private readonly stripe: StripeClient,
  ) {}

  async dashboard(organizationSlug: string): Promise<Dashboard> {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { slug: organizationSlug },
    });
    const tournaments = await this.prisma.tournament.findMany({
      where: { organizationId: organization.id, status: { not: 'ARCHIVED' } },
      orderBy: { startsAt: 'desc' },
    });
    const ids = tournaments.map((t) => t.id);
    const now = this.clock.now();
    const [counts, money, audience] = await Promise.all([
      this.prisma.registration.groupBy({
        by: ['tournamentId', 'status'],
        where: { tournamentId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.registration.groupBy({
        by: ['tournamentId'],
        where: {
          tournamentId: { in: ids },
          status: 'CONFIRMED',
          paidAt: { not: null },
        },
        _sum: { feeCents: true, serviceFeeCents: true },
      }),
      this.prisma.$queryRaw<
        { tournament_id: string; impressions: bigint; clicks: bigint }[]
      >`
        SELECT ts.tournament_id,
               COALESCE(SUM(a.impressions), 0)::bigint AS impressions,
               COALESCE(SUM(a.clicks), 0)::bigint AS clicks
        FROM audience_hourly a
        JOIN tournament_sponsor ts ON ts.id = a.tournament_sponsor_id
        WHERE ts.tournament_id = ANY(${ids})
        GROUP BY ts.tournament_id`,
    ]);
    // Paiements en cours : seulement les places encore tenues.
    const pending = await this.prisma.registration.groupBy({
      by: ['tournamentId'],
      where: {
        tournamentId: { in: ids },
        status: 'PENDING_PAYMENT',
        expiresAt: { gt: now },
      },
      _count: { _all: true },
    });
    const count = (id: string, status: string) =>
      counts.find((c) => c.tournamentId === id && c.status === status)?._count
        ._all ?? 0;

    const rows: DashboardTournament[] = tournaments.map((t) => {
      const paid = money.find((m) => m.tournamentId === t.id)?._sum;
      const seen = audience.find((a) => a.tournament_id === t.id);
      return {
        slug: t.slug,
        name: t.name,
        status: t.status as DashboardTournament['status'],
        startsAt: t.startsAt.toISOString(),
        teamCount: t.teamCount,
        maxTeams: t.maxTeams,
        registrations: {
          confirmed: count(t.id, 'CONFIRMED'),
          pending:
            pending.find((p) => p.tournamentId === t.id)?._count._all ?? 0,
          waitlisted: count(t.id, 'WAITLISTED'),
        },
        collectedCents: paid?.feeCents ?? 0,
        serviceFeeCents: paid?.serviceFeeCents ?? 0,
        audience: {
          impressions: Number(seen?.impressions ?? 0),
          clicks: Number(seen?.clicks ?? 0),
        },
      };
    });

    return {
      tournaments: rows,
      totals: {
        tournaments: rows.length,
        teams: rows.reduce((n, t) => n + t.teamCount, 0),
        collectedCents: rows.reduce((n, t) => n + t.collectedCents, 0),
        impressions: rows.reduce((n, t) => n + t.audience.impressions, 0),
        clicks: rows.reduce((n, t) => n + t.audience.clicks, 0),
      },
      payouts: await this.payouts(
        organization.stripeChargesEnabled ? organization.stripeAccountId : null,
      ),
    };
  }

  /** Inscriptions d'un tournoi du club, pour le secrétariat. */
  async registrationsCsv(organizationSlug: string, slug: string) {
    const tournament = await this.tournament(organizationSlug, slug);
    const registrations = await this.prisma.registration.findMany({
      where: { tournamentId: tournament.id },
      include: { manager: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const csv = toCsv(
      [
        'Équipe',
        'Club',
        'Responsable',
        'Email',
        'Téléphone',
        'Joueurs',
        'Statut',
        'Droit d’inscription (€)',
        'Frais de service (€)',
        'Total payé (€)',
        'Inscrite le',
        'Payée le',
      ],
      registrations.map((r) => [
        r.teamName,
        r.club,
        r.managerName,
        r.manager?.email ?? '',
        r.phone,
        Array.isArray(r.players) ? r.players.length : 0,
        STATUS_LABEL[r.status] ?? r.status,
        euros(r.feeCents),
        euros(r.serviceFeeCents),
        r.paidAt ? euros(r.totalCents) : '',
        DATE.format(r.createdAt),
        r.paidAt ? DATE.format(r.paidAt) : '',
      ]),
    );
    return { filename: `inscriptions-${tournament.slug}.csv`, csv };
  }

  /** Effectifs des équipes du tournoi (inscrites en ligne ou ajoutées par le club). */
  async playersCsv(organizationSlug: string, slug: string) {
    const tournament = await this.tournament(organizationSlug, slug);
    const teams = await this.prisma.team.findMany({
      where: { tournamentId: tournament.id },
      include: {
        players: { orderBy: { number: 'asc' } },
        registration: true,
      },
      orderBy: { name: 'asc' },
    });
    const rows = teams.flatMap((team) => {
      const fromRegistration = Array.isArray(team.registration?.players)
        ? (team.registration.players as PlayerEntry[])
        : null;
      if (fromRegistration && fromRegistration.length > 0) {
        return fromRegistration.map((p) => [
          team.name,
          team.club,
          p.number ?? '',
          p.lastName ?? '',
          p.firstName ?? '',
        ]);
      }
      return team.players.map((p) => [
        team.name,
        team.club,
        p.number,
        p.name,
        '',
      ]);
    });
    const csv = toCsv(['Équipe', 'Club', 'Numéro', 'Nom', 'Prénom'], rows);
    return { filename: `effectifs-${tournament.slug}.csv`, csv };
  }

  private async tournament(organizationSlug: string, slug: string) {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    return tournament;
  }

  private async payouts(account: string | null): Promise<Dashboard['payouts']> {
    if (!account || !this.stripe.enabled) {
      return null;
    }
    try {
      const [balance, payouts] = await Promise.all([
        this.stripe.balance(account),
        this.stripe.payouts(account),
      ]);
      const eur = (list: { amount: number; currency: string }[]) =>
        list
          .filter((b) => b.currency === 'eur')
          .reduce((n, b) => n + b.amount, 0);
      return {
        availableCents: eur(balance.available),
        pendingCents: eur(balance.pending),
        recent: payouts.data.map((p) => ({
          amountCents: p.amount,
          arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
          status: p.status,
        })),
      };
    } catch (error) {
      // Le tableau de bord reste utile sans Stripe.
      this.logger.warn(`Solde Stripe indisponible : ${String(error)}`);
      return null;
    }
  }
}
