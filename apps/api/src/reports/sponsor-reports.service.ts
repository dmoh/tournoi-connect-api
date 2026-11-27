import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { Clock } from '../common/clock.js';
import { parisHour } from '../common/paris-time.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { Mailer } from '../mail/mailer.js';
import { sponsorReportMail } from '../mail/templates.js';
import { REPORT_QUEUE } from '../queue/queue.module.js';
import type { SponsorReport } from './sponsor-reports.schemas.js';

const HOUR = 60 * 60_000;
/** Le bilan part le lendemain : 12 h après la fin du tournoi… */
export const REPORT_AFTER_HOURS = 12;
/** …et au plus tard une semaine après (worker arrêté, rattrapage). */
export const REPORT_WITHIN_DAYS = 7;

/** Pas de bilan la nuit : de 8 h à 20 h, heure de Paris. */
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 20;
/** Bilans cherchés par lots. */
const BATCH = 200;

/** « lundi 9 novembre 2026 » */
export const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Bilan des partenaires : le lendemain du tournoi, chaque partenaire payé
 * (adresse connue, non désinscrit des sollicitations du club) reçoit ses
 * chiffres et le lien de sa page de bilan, une seule fois. Rien à faire
 * pour le club.
 */
@Injectable()
export class SponsorReportsService {
  private readonly logger = new Logger('Bilans partenaires');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @InjectQueue(REPORT_QUEUE)
    readonly queue?: Queue,
  ) {}

  /**
   * Balayage horaire du worker : les bilans arrivés à échéance, de 8 h à
   * 20 h (heure de Paris), par lots dans l'ordre des fins de tournoi. Un
   * échec fait échouer le travail : la relance reprend ce qui manque.
   */
  async sweep(): Promise<number> {
    const nowDate = this.clock.now();
    const hour = parisHour(nowDate);
    if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) {
      return 0;
    }
    const now = nowDate.getTime();
    let sent = 0;
    let failed = 0;
    let cursor: string | undefined;
    for (;;) {
      const due = await this.prisma.tournamentSponsor.findMany({
        where: {
          status: 'PAID',
          reportSentAt: null,
          sponsor: { email: { not: null } },
          tournament: {
            status: { notIn: ['CANCELLED', 'DRAFT', 'ARCHIVED'] },
            endsAt: {
              lte: new Date(now - REPORT_AFTER_HOURS * HOUR),
              gte: new Date(now - REPORT_WITHIN_DAYS * 24 * HOUR),
            },
          },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      for (const { id } of due) {
        try {
          sent += (await this.send(id)) ? 1 : 0;
        } catch (error) {
          failed += 1;
          this.logger.error(`Bilan ${id} : ${String(error)}`);
        }
      }
      if (due.length < BATCH) {
        break;
      }
      cursor = due[due.length - 1]!.id;
    }
    if (sent > 0) {
      this.logger.log(`${sent} bilan(s) de partenaire envoyé(s).`);
    }
    if (failed > 0) {
      throw new Error(`${failed} bilan(s) à relancer.`);
    }
    return sent;
  }

  /**
   * Un bilan : tout est préparé, puis réservé (un second passage n'envoie
   * rien) ; un envoi en échec rend la réservation, pour la relance.
   */
  async send(id: string): Promise<boolean> {
    const row = await this.prisma.tournamentSponsor.findUnique({
      where: { id },
      include: { sponsor: true, tournament: true },
    });
    const email = row?.sponsor.email?.toLowerCase();
    if (!row || !email || row.reportSentAt) {
      return false;
    }
    // Désinscrit des sollicitations du club : marqué, jamais écrit.
    const optedOut = await this.prisma.editionInvite.count({
      where: {
        organizationId: row.tournament.organizationId,
        email,
        optedOutAt: { not: null },
      },
    });
    if (optedOut > 0) {
      await this.prisma.tournamentSponsor.updateMany({
        where: { id, reportSentAt: null },
        data: { reportSentAt: this.clock.now() },
      });
      return false;
    }
    // Jeton de désinscription, le même que pour les invitations du club.
    await this.prisma.editionInvite.createMany({
      data: [
        {
          organizationId: row.tournament.organizationId,
          tournamentId: row.tournamentId,
          email,
        },
      ],
      skipDuplicates: true,
    });
    const invite = await this.prisma.editionInvite.findUniqueOrThrow({
      where: { tournamentId_email: { tournamentId: row.tournamentId, email } },
      select: { token: true },
    });
    const report = await this.report(row.reportToken);
    const message = sponsorReportMail(email, {
      ...report,
      date: DATE_FORMAT.format(row.tournament.startsAt),
      reportUrl: this.appUrl(`/bilan/${row.reportToken}`),
      unsubscribeUrl: this.appUrl(`/editions/desinscription/${invite.token}`),
      oneClickUrl: this.appUrl(
        `/api/v1/public/edition-invites/${invite.token}/opt-out`,
      ),
    });
    const claimedAt = this.clock.now();
    const { count } = await this.prisma.tournamentSponsor.updateMany({
      where: { id, reportSentAt: null },
      data: { reportSentAt: claimedAt },
    });
    if (count === 0) {
      return false;
    }
    try {
      await this.mailer.send(message);
    } catch (error) {
      await this.prisma.tournamentSponsor.updateMany({
        where: { id, reportSentAt: claimedAt },
        data: { reportSentAt: null },
      });
      throw error;
    }
    return true;
  }

  /** Bilan d'un partenariat par son lien ; inconnu ou pack non payé : 404. */
  async report(token: string): Promise<SponsorReport> {
    const row = await this.prisma.tournamentSponsor.findUnique({
      where: { reportToken: token },
      include: {
        sponsor: { select: { name: true } },
        tournament: {
          include: {
            venue: true,
            organization: { select: { name: true } },
            _count: {
              select: {
                teams: true,
                matches: { where: { status: 'FINISHED' } },
              },
            },
          },
        },
      },
    });
    if (!row || row.status !== 'PAID') {
      throw new NotFoundException('Bilan introuvable.');
    }
    const rows = await this.prisma.audienceHourly.groupBy({
      by: ['placement'],
      where: { tournamentSponsorId: row.id },
      _sum: { impressions: true, clicks: true },
    });
    const placements = rows
      .map((r) => ({
        placement: r.placement,
        impressions: r._sum.impressions ?? 0,
        clicks: r._sum.clicks ?? 0,
      }))
      .sort((a, b) => b.impressions - a.impressions);
    const t = row.tournament;
    return {
      club: t.organization.name,
      sponsor: row.sponsor.name,
      tier: row.tier,
      field: row.field,
      tournament: {
        slug: t.slug,
        name: t.name,
        startsAt: t.startsAt.toISOString(),
        venue: `${t.venue.name}, ${t.venue.city}`,
      },
      impressions: placements.reduce((n, p) => n + p.impressions, 0),
      clicks: placements.reduce((n, p) => n + p.clicks, 0),
      placements,
      teams: t._count.teams,
      matches: t._count.matches,
    };
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
