import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PhotoSource } from '../generated/prisma/enums.js';
import { MAINTENANCE_QUEUE } from '../queue/queue.module.js';
import {
  MEDIA_STORAGE,
  MediaStorage,
  PHOTO_TYPES,
  sniffPhotoType,
} from './media-storage.js';
import {
  MAX_PHOTO_BYTES,
  type PhotoUpload,
  type PhotoUploadRequest,
  type PublicPhoto,
} from './media.schemas.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Au plus, par match pour la table de marque, par tournoi pour le club. */
export const PHOTO_LIMITS = { perMatch: 30, perTournament: 500 } as const;

/** Conservation des photos après la fin du tournoi. */
export const PHOTO_RETENTION_DAYS = 365;
/** Une URL d'envoi jamais suivie d'une confirmation est oubliée le lendemain. */
const PENDING_RETENTION_DAYS = 1;
/** Ligne d'une photo masquée (sans son objet), comme un signalement traité. */
const HIDDEN_RETENTION_DAYS = 365;

/** Nom de la tâche du worker qui efface les objets des photos retirées. */
export const MEDIA_CLEANUP_JOB = 'media-cleanup';

/** Où une photo est rangée et par qui elle arrive. */
export interface PhotoTarget {
  tournamentId: string;
  matchId: string | null;
  source: PhotoSource;
  uploadedById: string | null;
}

type PhotoRow = Prisma.PhotoGetPayload<{
  include: { match: { select: { code: true } } };
}>;

/** Photos visibles : vérifiées, ni retirées ni masquées. */
export const VISIBLE_PHOTO = {
  status: 'READY',
  deletedAt: null,
  hiddenAt: null,
} as const satisfies Prisma.PhotoWhereInput;

/**
 * Photos des tournois : URL d'envoi signée (le fichier ne passe pas par
 * l'API), vérification de l'objet reçu, retrait, et effacement des objets
 * par le worker (retrait, modération, compte supprimé, fin de conservation).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Optional()
    @InjectQueue(MAINTENANCE_QUEUE)
    private readonly queue?: Queue,
  ) {}

  async requestUpload(
    target: PhotoTarget,
    input: PhotoUploadRequest,
  ): Promise<PhotoUpload> {
    if (!this.storage.enabled) {
      throw new ServiceUnavailableException(
        'L’envoi de photos n’est pas encore ouvert.',
      );
    }
    const used = await this.prisma.photo.count({
      where: {
        deletedAt: null,
        ...(target.source === 'REPORTER'
          ? { matchId: target.matchId, source: 'REPORTER' }
          : { tournamentId: target.tournamentId }),
      },
    });
    const limit =
      target.source === 'REPORTER'
        ? PHOTO_LIMITS.perMatch
        : PHOTO_LIMITS.perTournament;
    if (used >= limit) {
      throw new HttpException(
        `Limite atteinte : ${limit} photos au plus.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const storageKey = `photos/${target.tournamentId}/${randomUUID()}.${PHOTO_TYPES[input.contentType]}`;
    const photo = await this.prisma.photo.create({
      data: {
        ...target,
        storageKey,
        contentType: input.contentType,
        bytes: input.bytes,
        width: input.width,
        height: input.height,
        caption: input.caption ?? null,
        createdAt: this.clock.now(),
      },
    });
    const signed = await this.storage.signUpload(
      storageKey,
      input.contentType,
      input.bytes,
      this.clock.now(),
    );
    return {
      photoId: photo.id,
      uploadUrl: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /**
   * Vérifie l'objet envoyé (présent, taille annoncée, vrai JPEG ou WebP) et
   * publie la photo. Un fichier non conforme est retiré.
   */
  async confirm(
    photoId: string,
    scope: Prisma.PhotoWhereInput,
  ): Promise<PublicPhoto> {
    const photo = await this.prisma.photo.findFirst({
      where: { ...scope, id: photoId, deletedAt: null, hiddenAt: null },
      include: { match: { select: { code: true } } },
    });
    if (!photo) {
      throw new NotFoundException('Photo introuvable.');
    }
    if (photo.status === 'READY') {
      return this.toPublic(photo);
    }
    const stored = await this.storage.inspect(photo.storageKey);
    if (!stored) {
      throw new ConflictException('La photo n’est pas encore arrivée.');
    }
    if (
      stored.bytes !== photo.bytes ||
      stored.bytes > MAX_PHOTO_BYTES ||
      sniffPhotoType(stored.head) !== photo.contentType
    ) {
      await this.remove({ id: photo.id });
      throw new UnprocessableEntityException(
        'Le fichier reçu n’est pas une photo JPEG ou WebP de la taille annoncée.',
      );
    }
    const ready = await this.prisma.photo.update({
      where: { id: photo.id },
      data: { status: 'READY' },
      include: { match: { select: { code: true } } },
    });
    return this.toPublic(ready);
  }

  /** Photos publiées d'un tournoi, les plus récentes d'abord. */
  async list(where: Prisma.PhotoWhereInput, take: number): Promise<PhotoRow[]> {
    return this.prisma.photo.findMany({
      where: { ...where, ...VISIBLE_PHOTO },
      include: { match: { select: { code: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  /** Retire des photos ; leurs objets sont effacés par le worker. */
  async remove(where: Prisma.PhotoWhereInput): Promise<number> {
    const { count } = await this.prisma.photo.updateMany({
      where: { ...where, deletedAt: null },
      data: { deletedAt: this.clock.now() },
    });
    if (count > 0) {
      await this.scheduleCleanup();
    }
    return count;
  }

  /** Efface au plus tôt les objets retirés : dans le worker, ou ici sans Redis. */
  async scheduleCleanup(): Promise<void> {
    if (this.queue) {
      await this.queue.add(MEDIA_CLEANUP_JOB, {});
    } else {
      await this.cleanup();
    }
  }

  /**
   * Efface du stockage les photos retirées, masquées, jamais confirmées ou
   * arrivées au bout de leur conservation. Une photo masquée garde sa ligne
   * (signalement traité) jusqu'à la purge des signalements.
   */
  async cleanup(): Promise<{ expired: number; removed: number }> {
    const now = this.clock.now();
    const expired = await this.prisma.photo.updateMany({
      where: {
        deletedAt: null,
        tournament: {
          endsAt: {
            lt: new Date(now.getTime() - PHOTO_RETENTION_DAYS * DAY_MS),
          },
        },
      },
      data: { deletedAt: now },
    });
    let removed = 0;
    for (;;) {
      const batch = await this.prisma.photo.findMany({
        where: {
          removedAt: null,
          OR: [
            { deletedAt: { not: null } },
            { hiddenAt: { not: null } },
            {
              status: 'PENDING',
              createdAt: {
                lt: new Date(now.getTime() - PENDING_RETENTION_DAYS * DAY_MS),
              },
            },
          ],
        },
        select: { id: true, storageKey: true, hiddenAt: true, deletedAt: true },
        take: 500,
      });
      if (batch.length === 0) {
        break;
      }
      await this.storage.remove(batch.map((p) => p.storageKey));
      const kept = batch.filter((p) => p.hiddenAt && !p.deletedAt);
      await this.prisma.photo.deleteMany({
        where: {
          id: { in: batch.filter((p) => !kept.includes(p)).map((p) => p.id) },
        },
      });
      await this.prisma.photo.updateMany({
        where: { id: { in: kept.map((p) => p.id) } },
        data: { removedAt: now },
      });
      removed += batch.length;
    }
    // Ligne d'une photo masquée : gardée autant qu'un signalement traité.
    await this.prisma.photo.deleteMany({
      where: {
        removedAt: { not: null },
        hiddenAt: {
          lt: new Date(now.getTime() - HIDDEN_RETENTION_DAYS * DAY_MS),
        },
      },
    });
    if (expired.count + removed > 0) {
      this.logger.log(
        `Photos : ${expired.count} arrivées à échéance, ${removed} effacées du stockage.`,
      );
    }
    return { expired: expired.count, removed };
  }

  url(storageKey: string): string {
    return this.storage.publicUrl(storageKey);
  }

  toPublic(photo: PhotoRow): PublicPhoto {
    return {
      id: photo.id,
      url: this.url(photo.storageKey),
      width: photo.width,
      height: photo.height,
      caption: photo.caption,
      matchCode: photo.match?.code ?? null,
      highlight: photo.highlight,
      source: photo.source === 'REPORTER' ? 'reporter' : 'club',
      createdAt: photo.createdAt.toISOString(),
    };
  }
}
