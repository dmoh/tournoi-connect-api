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
import {
  addDays,
  nextEditionDate,
  parisDate,
  parisTime,
} from '../common/paris-time.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import type { TournamentFormat } from '../generated/prisma/enums.js';
import { Mailer } from '../mail/mailer.js';
import { editionInviteMail } from '../mail/templates.js';
import type { NextEdition } from '../organizer/organizer.schemas.js';
import type { EditionOptOut } from './editions.schemas.js';
import { EDITION_QUEUE } from '../queue/queue.module.js';
import { registrationQuote } from '../registrations/pricing.js';
import { SponsorInvites } from '../sponsorships/sponsor-invites.service.js';

/** « lundi 8 novembre 2027 » : envoyé un an à l'avance, l'année compte. */
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
});

/** Sans date de clôture connue : une semaine avant le tournoi. */
const DEFAULT_DEADLINE_DAYS = 7;

const FORMATS: Record<TournamentFormat, NextEdition['draft']['format']> = {
  SINGLE_GROUP: 'single-group',
  GROUPS_KNOCKOUT: 'groups-knockout',
  KNOCKOUT: 'knockout',
  SWISS: 'swiss',
};

const TIER_ORDER = { GOLD: 0, SILVER: 1, BRONZE: 2, FIELD: 3 } as const;

/**
 * Terrain gardé d'une édition à l'autre : « Terrain N » au même lieu, s'il
 * existe encore ; sinon le club le choisira.
 */
function keptField(
  partner: { tier: string; field: string | null },
  t: { fieldCount: number; sameVenue: boolean },
): string | null {
  const number = /^terrain\s+(\d+)$/i.exec(partner.field?.trim() ?? '')?.[1];
  return partner.tier === 'FIELD' &&
    t.sameVenue &&
    number !== undefined &&
    Number(number) <= t.fieldCount
    ? partner.field
    : null;
}

export interface EditionInvitesJob {
  tournamentId: string;
  /** Écrire aux équipes de l'édition précédente. */
  teams?: boolean;
  /** Proposer aux partenaires de l'édition précédente de renouveler leur pack. */
  sponsors?: boolean;
}

/** « Tournoi de la Toussaint 2026 » → « … 2027 » ; un nom sans année reste tel quel. */
export function nextEditionName(name: string): string {
  return name.replace(/\b(20\d{2})\b/g, (year) => String(Number(year) + 1));
}

/**
 * Édition suivante d'un tournoi : un brouillon complet de l'assistant (le
 * club n'a qu'à publier), et l'invitation des responsables d'équipe de
 * l'édition précédente, une seule fois, par le worker.
 */
@Injectable()
export class EditionsService {
  private readonly logger = new Logger('Éditions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
    private readonly sponsorInvites: SponsorInvites,
    @Optional()
    @InjectQueue(EDITION_QUEUE)
    private readonly queue?: Queue<EditionInvitesJob>,
  ) {}

  /** Brouillon de l'édition suivante d'un tournoi du club ; ailleurs : 404. */
  async nextEdition(
    organizationSlug: string,
    slug: string,
  ): Promise<NextEdition> {
    const t = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: organizationSlug } },
      include: {
        venue: true,
        nextEditions: {
          orderBy: { startsAt: 'desc' },
          select: {
            slug: true,
            name: true,
            editionInvitesSentAt: true,
            sponsorRenewalsSentAt: true,
          },
        },
        packages: { select: { tier: true, priceCents: true } },
      },
    });
    if (!t) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const startDay = parisDate(t.startsAt);
    const date = nextEditionDate(startDay);
    const shift =
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) /
      86_400_000;
    const deadline = t.registrationDeadline
      ? addDays(t.registrationDeadline.toISOString().slice(0, 10), shift)
      : addDays(date, -DEFAULT_DEADLINE_DAYS);
    const prices = new Map(t.packages.map((p) => [p.tier, p.priceCents]));
    // Qui reçoit quoi, et à quel prix (frais de service compris).
    const partners = (await this.renewable(t.id, t.organizationId)).map(
      (p) => ({
        name: p.sponsor.name,
        tier: p.tier,
        field: p.field,
        totalCents: registrationQuote(prices.get(p.tier) ?? 0).totalCents,
      }),
    );
    return {
      draft: {
        name: nextEditionName(t.name),
        sport: t.sport,
        date,
        startTime: parisTime(t.startsAt),
        endTime: parisTime(t.endsAt),
        venueName: t.venue.name,
        city: t.venue.city,
        lat: t.venue.lat,
        lng: t.venue.lng,
        fields: t.fieldCount,
        outdoor: t.venue.outdoor,
        categories: t.categories,
        maxTeams: t.maxTeams,
        feeEuros: t.feeCents / 100,
        // La clôture ne peut suivre le tournoi (fin de mois décalée, par exemple).
        registrationDeadline: deadline <= date ? deadline : date,
        format: FORMATS[t.format],
        matchMinutes: t.matchMinutes,
        breakMinutes: t.breakMinutes,
        ...(t.rankingRules
          ? { rules: t.rankingRules as NextEdition['draft']['rules'] }
          : {}),
      },
      previous: {
        slug: t.slug,
        name: t.name,
        startsAt: t.startsAt.toISOString(),
        teams: (await this.recipients(t.id, t.organizationId)).length,
        // Une autre édition a déjà écrit aux équipes : on ne les relance pas.
        invited: t.nextEditions.some((e) => e.editionInvitesSentAt !== null),
        partners,
        sponsors: partners.length,
        sponsorsRenewed: t.nextEditions.some(
          (e) => e.sponsorRenewalsSentAt !== null,
        ),
        packages: [...t.packages].sort(
          (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier],
        ),
      },
      existing: t.nextEditions[0]
        ? { slug: t.nextEditions[0].slug, name: t.nextEditions[0].name }
        : null,
    };
  }

  /**
   * Packs de l'édition précédente repris par la nouvelle (même palier, prix
   * et inventaire), si elle n'en a pas encore.
   */
  async copyPackages(
    previousId: string,
    tournamentId: string,
  ): Promise<number> {
    const packages = await this.prisma.sponsorPackage.findMany({
      where: { tournamentId: previousId },
      select: { tier: true, priceCents: true, inventory: true },
    });
    const { count } = await this.prisma.sponsorPackage.createMany({
      data: packages.map((p) => ({ ...p, tournamentId })),
      skipDuplicates: true,
    });
    return count;
  }

  /** Dépose les invitations dans la file du worker ; sans Redis, les envoie tout de suite. */
  async enqueueInvites(
    tournamentId: string,
    what: { teams: boolean; sponsors: boolean } = {
      teams: true,
      sponsors: false,
    },
  ): Promise<void> {
    if (!what.teams && !what.sponsors) {
      return;
    }
    if (this.queue) {
      await this.queue.add(
        'invite',
        { tournamentId, ...what },
        { jobId: `edition-invites-${tournamentId}` },
      );
      return;
    }
    try {
      await this.process({ tournamentId, ...what });
    } catch (error) {
      this.logger.error(
        `Invitations de l'édition ${tournamentId} : ${String(error)}`,
      );
    }
  }

  /** Tâche du worker : équipes, puis partenaires, chacun une seule fois. */
  async process(job: EditionInvitesJob): Promise<number> {
    let sent = 0;
    // Anciennes tâches (sans drapeaux) : les équipes seulement.
    if (job.teams ?? true) {
      sent += await this.inviteTeams(job.tournamentId);
    }
    if (job.sponsors) {
      sent += await this.renewSponsors(job.tournamentId);
    }
    return sent;
  }

  /**
   * Propose aux partenaires de l'édition précédente (pack payé, adresse
   * connue) le même pack sur la nouvelle : lien de paiement personnel par
   * email. Une seule fois par édition, une seule édition pour un même
   * tournoi, dans la limite de l'inventaire des packs.
   */
  async renewSponsors(tournamentId: string): Promise<number> {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        venue: true,
        previousEdition: { select: { id: true, name: true, venueId: true } },
      },
    });
    if (
      !t?.previousEdition ||
      !['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'PUBLISHED'].includes(
        t.status,
      ) ||
      !(await this.claim('sponsorRenewalsSentAt', t.id, t.previousEdition.id))
    ) {
      return 0;
    }
    const previous = t.previousEdition;
    const [partners, packages] = await Promise.all([
      this.renewable(previous.id, t.organizationId),
      this.prisma.sponsorPackage.findMany({ where: { tournamentId: t.id } }),
    ]);
    const renewal = {
      previous: previous.name,
      date: DATE_FORMAT.format(t.startsAt),
      venue: `${t.venue.name}, ${t.venue.city}`,
    };
    let renewed = 0;
    let failed = 0;
    // Chaque partenaire à part : un échec n'arrête pas les autres ; la
    // relance du travail reprend ceux qui manquent, sans doublon.
    for (const partner of partners) {
      try {
        const sent = await this.renewOne(
          { ...t, sameVenue: t.venueId === previous.venueId },
          partner,
          packages,
          renewal,
        );
        renewed += sent ? 1 : 0;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Renouvellement de ${partner.sponsor.name} (${t.slug}) : ${String(error)}`,
        );
      }
    }
    this.logger.log(
      `Édition ${t.slug} : ${renewed} partenaire(s) invité(s) à renouveler.`,
    );
    if (failed > 0) {
      throw new Error(`${failed} partenaire(s) à relancer (${t.slug}).`);
    }
    return renewed;
  }

  /** Un partenaire : sa place réservée (inventaire verrouillé), puis son lien par email. */
  private async renewOne(
    t: {
      id: string;
      organizationId: string;
      fieldCount: number;
      sameVenue: boolean;
    },
    partner: Awaited<ReturnType<EditionsService['renewable']>>[number],
    packages: readonly { id: string; tier: string; inventory: number }[],
    renewal: { previous: string; date: string; venue: string },
  ): Promise<boolean> {
    const pack = packages.find((p) => p.tier === partner.tier);
    if (!pack) {
      return false;
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tournamentSponsor.findUnique({
        where: {
          tournamentId_sponsorId: {
            tournamentId: t.id,
            sponsorId: partner.sponsorId,
          },
        },
      });
      if (existing) {
        // Relance du travail : place prise, lien pas encore envoyé.
        return existing.status === 'INVITED' && !existing.inviteTokenHash
          ? existing
          : null;
      }
      // Le pack est verrouillé : une invitation simultanée ne le survend pas.
      await tx.$executeRaw`SELECT id FROM sponsor_package WHERE id = ${pack.id} FOR UPDATE`;
      const taken = await tx.tournamentSponsor.count({
        where: {
          tournamentId: t.id,
          tier: partner.tier,
          status: { not: 'PROSPECT' },
        },
      });
      if (taken >= pack.inventory) {
        return null;
      }
      return tx.tournamentSponsor.create({
        data: {
          tournamentId: t.id,
          sponsorId: partner.sponsorId,
          status: 'INVITED',
          tier: partner.tier,
          field: keptField(partner, t),
          invitedAt: this.clock.now(),
        },
      });
    });
    if (!row) {
      return false;
    }
    // Jeton de désinscription (« Ne plus être sollicité par ce club »).
    const email = partner.sponsor.email!.toLowerCase();
    await this.prisma.editionInvite.createMany({
      data: [{ organizationId: t.organizationId, tournamentId: t.id, email }],
      skipDuplicates: true,
    });
    const invite = await this.prisma.editionInvite.findUniqueOrThrow({
      where: { tournamentId_email: { tournamentId: t.id, email } },
      select: { id: true, token: true },
    });
    await this.sponsorInvites.issue(row.id, this.prisma, {
      ...renewal,
      unsubscribeUrl: this.appUrl(`/editions/desinscription/${invite.token}`),
      oneClickUrl: this.appUrl(
        `/api/v1/public/edition-invites/${invite.token}/opt-out`,
      ),
    });
    await this.prisma.editionInvite.update({
      where: { id: invite.id },
      data: { mailedAt: this.clock.now() },
    });
    return true;
  }

  /**
   * Une seule édition écrit aux équipes (ou aux partenaires) d'un même
   * tournoi : la première à le réclamer, sous verrou. Vrai si c'est
   * celle-ci (déjà réclamé par elle : relance du travail).
   */
  private claim(
    column: 'editionInvitesSentAt' | 'sponsorRenewalsSentAt',
    tournamentId: string,
    previousId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${previousId}))`;
      const owners = await tx.tournament.findMany({
        where: { previousEditionId: previousId, [column]: { not: null } },
        select: { id: true },
      });
      if (owners.some((o) => o.id !== tournamentId)) {
        return false;
      }
      if (owners.length === 0) {
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { [column]: this.clock.now() },
        });
      }
      return true;
    });
  }

  /**
   * Partenaires d'un tournoi à relancer : pack payé, adresse connue, pas
   * désinscrits des sollicitations du club ; un par sponsor, avec son pack
   * le plus haut (Or avant Argent…).
   */
  private async renewable(tournamentId: string, organizationId: string) {
    const [rows, optedOut] = await Promise.all([
      this.prisma.tournamentSponsor.findMany({
        where: {
          tournamentId,
          status: 'PAID',
          sponsor: { email: { not: null } },
        },
        select: {
          sponsorId: true,
          tier: true,
          field: true,
          sponsor: { select: { name: true, email: true } },
        },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.editionInvite.findMany({
        where: { organizationId, optedOutAt: { not: null } },
        select: { email: true },
      }),
    ]);
    const excluded = new Set(optedOut.map((o) => o.email));
    const best = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (excluded.has(row.sponsor.email!.toLowerCase())) {
        continue;
      }
      const current = best.get(row.sponsorId);
      if (!current || TIER_ORDER[row.tier] < TIER_ORDER[current.tier]) {
        best.set(row.sponsorId, row);
      }
    }
    return [...best.values()].sort(
      (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier],
    );
  }

  /**
   * Invite les responsables d'équipe de l'édition précédente, une seule fois
   * par édition (et une seule édition invite pour un même tournoi), tant que
   * les inscriptions sont ouvertes.
   */
  async inviteTeams(tournamentId: string): Promise<number> {
    const t = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        venue: true,
        organization: { select: { name: true } },
        previousEdition: { select: { id: true, name: true } },
      },
    });
    if (
      !t?.previousEdition ||
      t.status !== 'REGISTRATION_OPEN' ||
      !(await this.claim('editionInvitesSentAt', t.id, t.previousEdition.id))
    ) {
      return 0;
    }
    const recipients = await this.recipients(
      t.previousEdition.id,
      t.organizationId,
    );
    // Une invitation par adresse, avec son jeton de désinscription.
    await this.prisma.editionInvite.createMany({
      data: recipients.map((email) => ({
        organizationId: t.organizationId,
        tournamentId: t.id,
        email,
      })),
      skipDuplicates: true,
    });
    // Relance du travail : seulement les emails pas encore déposés.
    const invites = await this.prisma.editionInvite.findMany({
      where: { tournamentId: t.id, email: { in: recipients }, mailedAt: null },
      select: { id: true, email: true, token: true },
    });
    const joinUrl = this.appUrl(`/join/${encodeURIComponent(t.slug)}`);
    for (const invite of invites) {
      await this.mailer.send(
        editionInviteMail(invite.email, {
          tournament: t.name,
          previous: t.previousEdition.name,
          club: t.organization.name,
          date: DATE_FORMAT.format(t.startsAt),
          venue: `${t.venue.name}, ${t.venue.city}`,
          deadline: t.registrationDeadline
            ? DATE_FORMAT.format(t.registrationDeadline)
            : null,
          fee:
            t.feeCents > 0
              ? `${EUROS.format(t.feeCents / 100)} par équipe`
              : 'Inscription gratuite',
          joinUrl,
          unsubscribeUrl: this.appUrl(
            `/editions/desinscription/${invite.token}`,
          ),
          oneClickUrl: this.appUrl(
            `/api/v1/public/edition-invites/${invite.token}/opt-out`,
          ),
        }),
      );
      await this.prisma.editionInvite.update({
        where: { id: invite.id },
        data: { mailedAt: this.clock.now() },
      });
    }
    this.logger.log(
      `Édition ${t.slug} : ${recipients.length} équipe(s) de l'édition précédente invitée(s).`,
    );
    return invites.length;
  }

  /** Invitation d'un lien de désinscription ; inconnue : 404. */
  async optOutInfo(token: string): Promise<EditionOptOut> {
    const invite = await this.prisma.editionInvite.findUnique({
      where: { token },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!invite) {
      throw new NotFoundException('Lien de désinscription inconnu.');
    }
    const optedOut = await this.prisma.editionInvite.count({
      where: {
        organizationId: invite.organizationId,
        email: invite.email,
        optedOutAt: { not: null },
      },
    });
    return { club: invite.organization.name, optedOut: optedOut > 0 };
  }

  /** Désinscription (lien de l'email, ou un clic du client mail) : rejouer ne change rien. */
  async optOut(token: string): Promise<EditionOptOut> {
    const invite = await this.prisma.editionInvite.findUnique({
      where: { token },
      select: { id: true },
    });
    if (!invite) {
      throw new NotFoundException('Lien de désinscription inconnu.');
    }
    await this.prisma.editionInvite.updateMany({
      where: { id: invite.id, optedOutAt: null },
      data: { optedOutAt: this.clock.now() },
    });
    return this.optOutInfo(token);
  }

  /**
   * Adresses distinctes des responsables d'équipe inscrites à un tournoi
   * (confirmées ; pour un tournoi annulé, celles que l'annulation a rendues),
   * sans celles qui se sont désinscrites des invitations du club.
   */
  private async recipients(
    tournamentId: string,
    organizationId: string,
  ): Promise<string[]> {
    const [rows, optedOut] = await Promise.all([
      this.prisma.registration.findMany({
        where: {
          tournamentId,
          manager: { isNot: null },
          OR: [
            { status: 'CONFIRMED' },
            { status: 'CANCELLED', cancellation: 'TOURNAMENT_CANCELLED' },
          ],
        },
        select: { manager: { select: { email: true } } },
      }),
      this.prisma.editionInvite.findMany({
        where: { organizationId, optedOutAt: { not: null } },
        select: { email: true },
      }),
    ]);
    const excluded = new Set(optedOut.map((o) => o.email));
    return [
      ...new Set(
        rows.flatMap((r) => (r.manager ? [r.manager.email.toLowerCase()] : [])),
      ),
    ].filter((email) => !excluded.has(email));
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
