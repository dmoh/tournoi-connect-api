import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { contentHiddenMail, reportReceivedMail } from '../mail/templates.js';
import { Mailer } from '../mail/mailer.js';
import { MediaService, VISIBLE_PHOTO } from '../media/media.service.js';
import { PUBLIC_STATUSES } from '../public/public-mapping.js';
import type {
  CreateReport,
  PlatformReport,
  ReportListQuery,
} from './moderation.schemas.js';

/** Au-delà, les signalements d'un même tournoi attendent l'heure suivante. */
export const REPORTS_PER_HOUR = 30;

/**
 * Signalement des contenus publics et modération par les admins de la
 * plateforme : masquer une page de tournoi ou une actualité, ou écarter le
 * signalement. Le club est prévenu quand son contenu est masqué.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
    private readonly media: MediaService,
  ) {}

  async report(slug: string, input: CreateReport): Promise<{ id: string }> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      select: { id: true, name: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    if (input.postId) {
      const post = await this.prisma.post.findFirst({
        where: {
          id: input.postId,
          tournamentId: tournament.id,
          hiddenAt: null,
        },
        select: { id: true },
      });
      if (!post) {
        throw new NotFoundException('Actualité introuvable.');
      }
    }
    if (input.photoId) {
      const photo = await this.prisma.photo.findFirst({
        where: {
          id: input.photoId,
          tournamentId: tournament.id,
          ...VISIBLE_PHOTO,
        },
        select: { id: true },
      });
      if (!photo) {
        throw new NotFoundException('Photo introuvable.');
      }
    }
    const now = this.clock.now();
    const recent = await this.prisma.report.count({
      where: {
        tournamentId: tournament.id,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    });
    if (recent >= REPORTS_PER_HOUR) {
      throw new HttpException(
        'Ce tournoi a reçu beaucoup de signalements : réessayez dans une heure.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const report = await this.prisma.report.create({
      data: {
        tournamentId: tournament.id,
        postId: input.postId ?? null,
        photoId: input.photoId ?? null,
        reason: input.reason,
        details: input.details,
        contactEmail: input.contactEmail ?? null,
      },
    });
    const admins = await this.prisma.user.findMany({
      where: { platformAdmin: true },
      select: { email: true },
    });
    for (const admin of admins) {
      await this.mailer.send(
        reportReceivedMail(admin.email, {
          tournament: tournament.name,
          reason: input.reason,
          url: this.appUrl('/platform'),
        }),
      );
    }
    return { id: report.id };
  }

  async list(query: ReportListQuery): Promise<PlatformReport[]> {
    const reports = await this.prisma.report.findMany({
      where: { status: query.status },
      orderBy: { createdAt: query.status === 'OPEN' ? 'asc' : 'desc' },
      take: 100,
      include: { tournament: { include: { organization: true } } },
    });
    const postIds = reports.flatMap((r) => (r.postId ? [r.postId] : []));
    const posts = new Map(
      (await this.prisma.post.findMany({ where: { id: { in: postIds } } })).map(
        (p) => [p.id, p],
      ),
    );
    const photoIds = reports.flatMap((r) => (r.photoId ? [r.photoId] : []));
    const photos = new Map(
      (
        await this.prisma.photo.findMany({ where: { id: { in: photoIds } } })
      ).map((p) => [p.id, p]),
    );
    return reports.map((r) => {
      const post = r.postId ? posts.get(r.postId) : undefined;
      const photo = r.photoId ? photos.get(r.photoId) : undefined;
      return {
        id: r.id,
        status: r.status,
        reason: r.reason,
        details: r.details,
        contactEmail: r.contactEmail,
        createdAt: r.createdAt.toISOString(),
        tournament: {
          slug: r.tournament.slug,
          name: r.tournament.name,
          organization: r.tournament.organization.name,
          hidden: r.tournament.hiddenAt !== null,
        },
        post: post
          ? {
              id: post.id,
              title: post.title,
              body: post.body,
              hidden: post.hiddenAt !== null,
            }
          : null,
        photo: r.photoId
          ? {
              id: r.photoId,
              url:
                photo && !photo.removedAt
                  ? this.media.url(photo.storageKey)
                  : null,
              caption: photo?.caption ?? null,
              hidden:
                !photo || photo.hiddenAt !== null || photo.deletedAt !== null,
            }
          : null,
      };
    });
  }

  /**
   * Masque le contenu signalé (actualité, ou page du tournoi) et clôt tous les
   * signalements ouverts sur ce même contenu ; prévient les propriétaires du club.
   */
  async hide(id: string, adminId: string): Promise<void> {
    const report = await this.openReport(id);
    const now = this.clock.now();
    const target = report.photoId
      ? { photoId: report.photoId }
      : report.postId
        ? { postId: report.postId }
        : { tournamentId: report.tournamentId, postId: null, photoId: null };
    const tournament = await this.prisma.$transaction(async (tx) => {
      if (report.photoId) {
        await tx.photo.updateMany({
          where: { id: report.photoId, hiddenAt: null },
          data: { hiddenAt: now },
        });
      } else if (report.postId) {
        await tx.post.updateMany({
          where: { id: report.postId, hiddenAt: null },
          data: { hiddenAt: now },
        });
      } else {
        await tx.tournament.update({
          where: { id: report.tournamentId },
          data: { hiddenAt: now },
        });
      }
      await tx.report.updateMany({
        where: { ...target, tournamentId: report.tournamentId, status: 'OPEN' },
        data: { status: 'HIDDEN', resolvedAt: now, resolvedById: adminId },
      });
      return tx.tournament.findUniqueOrThrow({
        where: { id: report.tournamentId },
        include: {
          organization: {
            include: {
              members: {
                where: { role: 'OWNER' },
                include: { user: { select: { email: true } } },
              },
            },
          },
        },
      });
    });
    if (report.photoId) {
      // L'objet est effacé du stockage : la photo ne s'affiche plus nulle part.
      await this.media.scheduleCleanup();
    }
    const post = report.postId
      ? await this.prisma.post.findUnique({ where: { id: report.postId } })
      : null;
    for (const owner of tournament.organization.members) {
      await this.mailer.send(
        contentHiddenMail(owner.user.email, {
          club: tournament.organization.name,
          tournament: tournament.name,
          what: report.photoId
            ? 'une photo'
            : post
              ? `l’actualité « ${post.title} »`
              : 'la page du tournoi',
        }),
      );
    }
  }

  async dismiss(id: string, adminId: string): Promise<void> {
    await this.openReport(id);
    await this.prisma.report.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        resolvedAt: this.clock.now(),
        resolvedById: adminId,
      },
    });
  }

  private async openReport(id: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, status: 'OPEN' },
    });
    if (!report) {
      throw new NotFoundException('Signalement introuvable ou déjà traité.');
    }
    return report;
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
