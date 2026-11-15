import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { isDemoAccount } from '../database/demo-data.js';
import { PrismaService } from '../database/prisma.service.js';
import { accountDeletedMail } from '../mail/templates.js';
import { Mailer } from '../mail/mailer.js';
import { MediaService, VISIBLE_PHOTO } from '../media/media.service.js';
import type { AccountExport } from './account.schemas.js';

/** Nom laissé sur une inscription confirmée dont le responsable est parti. */
export const DELETED_MANAGER = 'Compte supprimé';

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => value?.toISOString() ?? null;

/**
 * Droits RGPD du compte connecté : accès (export JSON de ses données) et
 * effacement (suppression du compte, inscriptions confirmées anonymisées).
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly media: MediaService,
  ) {}

  async export(userId: string): Promise<AccountExport> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        identities: { orderBy: { createdAt: 'asc' } },
        sessions: { orderBy: { createdAt: 'asc' } },
        memberships: {
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
        },
        sponsorAccess: {
          include: { sponsor: true },
          orderBy: { createdAt: 'asc' },
        },
        invitationsSent: {
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
        },
        registrations: {
          include: { tournament: true },
          orderBy: { createdAt: 'asc' },
        },
        follows: { orderBy: { createdAt: 'asc' } },
        pushSubscriptions: { orderBy: { createdAt: 'asc' } },
        photos: {
          where: VISIBLE_PHOTO,
          include: { tournament: { select: { slug: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('Compte introuvable.');
    }
    return {
      exportedAt: iso(this.clock.now()),
      account: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        locale: user.locale,
        createdAt: iso(user.createdAt),
      },
      identities: user.identities.map((i) => ({
        provider: i.provider,
        subject: i.subject,
        createdAt: iso(i.createdAt),
      })),
      sessions: user.sessions.map((s) => ({
        userAgent: s.userAgent,
        createdAt: iso(s.createdAt),
        lastUsedAt: iso(s.lastUsedAt),
        expiresAt: iso(s.expiresAt),
        revokedAt: isoOrNull(s.revokedAt),
      })),
      memberships: user.memberships.map((m) => ({
        organization: { slug: m.organization.slug, name: m.organization.name },
        role: m.role,
        createdAt: iso(m.createdAt),
      })),
      sponsorAccess: user.sponsorAccess.map((a) => ({
        sponsor: a.sponsor.name,
        createdAt: iso(a.createdAt),
      })),
      invitationsSent: user.invitationsSent.map((i) => ({
        organization: i.organization.slug,
        email: i.email,
        role: i.role,
        createdAt: iso(i.createdAt),
        acceptedAt: isoOrNull(i.acceptedAt),
        revokedAt: isoOrNull(i.revokedAt),
      })),
      registrations: user.registrations.map((r) => ({
        id: r.id,
        tournament: { slug: r.tournament.slug, name: r.tournament.name },
        teamName: r.teamName,
        club: r.club,
        managerName: r.managerName,
        phone: r.phone,
        players: r.players,
        status: r.status,
        totalCents: r.totalCents,
        paidAt: isoOrNull(r.paidAt),
        createdAt: iso(r.createdAt),
      })),
      follows: user.follows.map((f) => ({
        kind: f.kind,
        target: f.target,
        createdAt: iso(f.createdAt),
      })),
      pushSubscriptions: user.pushSubscriptions.map((p) => ({
        service: serviceOf(p.endpoint),
        tournaments: p.tournaments,
        teams: p.teams,
        kickoff: p.kickoff,
        goals: p.goals,
        results: p.results,
        createdAt: iso(p.createdAt),
        lastSentAt: isoOrNull(p.lastSentAt),
      })),
      photos: user.photos.map((p) => ({
        tournament: p.tournament.slug,
        url: this.media.url(p.storageKey),
        caption: p.caption,
        createdAt: iso(p.createdAt),
      })),
    };
  }

  /**
   * Supprime le compte, confirmé par la saisie de son adresse. Refusé tant
   * que le compte est seul propriétaire d'un club : le club resterait sans
   * personne pour le gérer.
   */
  async delete(userId: string, confirmation: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Compte introuvable.');
    }
    if (confirmation !== user.email) {
      throw new BadRequestException(
        'Saisissez l’adresse de votre compte pour confirmer la suppression.',
      );
    }
    if (isDemoAccount(user.email)) {
      throw new ConflictException(
        'Les comptes de test ne peuvent pas être supprimés.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.membership.findMany({
        where: { userId, role: 'OWNER' },
        include: {
          organization: {
            include: {
              _count: {
                select: {
                  members: {
                    where: { role: 'OWNER', userId: { not: userId } },
                  },
                },
              },
            },
          },
        },
      });
      const alone = owned
        .filter((m) => m.organization._count.members === 0)
        .map((m) => m.organization.name);
      if (alone.length > 0) {
        throw new ConflictException(
          `Vous êtes le seul propriétaire de ${alone.join(', ')}. Nommez un autre propriétaire avant de supprimer votre compte.`,
        );
      }
      // Les places tenues et la liste d'attente sont rendues ; les équipes
      // confirmées restent au tournoi, sans les coordonnées du responsable.
      await tx.registration.updateMany({
        where: { managerId: userId, status: 'PENDING_PAYMENT' },
        data: { status: 'EXPIRED', expiresAt: null, checkoutUrl: null },
      });
      await tx.registration.updateMany({
        where: { managerId: userId, status: 'WAITLISTED' },
        data: { status: 'CANCELLED' },
      });
      await tx.registration.updateMany({
        where: { managerId: userId, status: { not: 'CONFIRMED' } },
        data: { players: [] },
      });
      await tx.registration.updateMany({
        where: { managerId: userId },
        data: { managerName: DELETED_MANAGER, phone: '' },
      });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      // Ses photos sont retirées ; le worker efface les fichiers.
      await tx.photo.updateMany({
        where: { uploadedById: userId, deletedAt: null },
        data: { deletedAt: this.clock.now() },
      });
      await tx.loginCode.deleteMany({ where: { email: user.email } });
      // Identités, sessions, rôles, accès sponsor et suivis partent en cascade.
      await tx.user.delete({ where: { id: userId } });
    });
    await this.media.scheduleCleanup();
    await this.mailer.send(accountDeletedMail(user.email));
  }
}

/** Origine du service push (l'adresse complète identifie l'appareil). */
function serviceOf(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return '';
  }
}
