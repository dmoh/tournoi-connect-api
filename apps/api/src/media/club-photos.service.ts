import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { MemberRole } from '../generated/prisma/enums.js';
import type {
  ClubPhoto,
  ClubPhotoUploadRequest,
  PhotoUpload,
  PublicPhoto,
  UpdatePhoto,
} from './media.schemas.js';
import { MediaService } from './media.service.js';

/** Membre du club qui agit, tel que posé par OrganizerGuard. */
export interface ClubActor {
  organizationSlug: string;
  userId: string;
  role: MemberRole;
}

/**
 * Photos envoyées par le club depuis l'espace organisateur. Un bénévole
 * (STAFF) envoie et retire ses propres photos ; un admin choisit les temps
 * forts et retire n'importe quelle photo du tournoi.
 */
@Injectable()
export class ClubPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async list(actor: ClubActor, slug: string): Promise<ClubPhoto[]> {
    const tournamentId = await this.tournamentId(actor, slug);
    const photos = await this.prisma.photo.findMany({
      where: { tournamentId, status: 'READY', deletedAt: null, hiddenAt: null },
      include: {
        match: { select: { code: true } },
        uploadedBy: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return photos.map((p) => ({
      ...this.media.toPublic(p),
      uploadedBy: p.uploadedBy
        ? [p.uploadedBy.firstName, p.uploadedBy.lastName]
            .filter(Boolean)
            .join(' ') || p.uploadedBy.email
        : null,
    }));
  }

  async requestUpload(
    actor: ClubActor,
    slug: string,
    input: ClubPhotoUploadRequest,
  ): Promise<PhotoUpload> {
    const tournamentId = await this.tournamentId(actor, slug);
    let matchId: string | null = null;
    if (input.matchCode) {
      const match = await this.prisma.match.findUnique({
        where: { tournamentId_code: { tournamentId, code: input.matchCode } },
        select: { id: true },
      });
      if (!match) {
        throw new NotFoundException('Match introuvable.');
      }
      matchId = match.id;
    }
    return this.media.requestUpload(
      {
        tournamentId,
        matchId,
        source: 'CLUB',
        uploadedById: actor.userId,
      },
      input,
    );
  }

  async confirm(
    actor: ClubActor,
    slug: string,
    photoId: string,
  ): Promise<PublicPhoto> {
    const tournamentId = await this.tournamentId(actor, slug);
    return this.media.confirm(photoId, {
      tournamentId,
      source: 'CLUB',
      uploadedById: actor.userId,
    });
  }

  async update(
    actor: ClubActor,
    slug: string,
    photoId: string,
    input: UpdatePhoto,
  ): Promise<PublicPhoto> {
    const photo = await this.visible(actor, slug, photoId);
    const updated = await this.prisma.photo.update({
      where: { id: photo.id },
      data: {
        ...(input.highlight !== undefined
          ? { highlight: input.highlight }
          : {}),
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
      },
      include: { match: { select: { code: true } } },
    });
    return this.media.toPublic(updated);
  }

  async remove(actor: ClubActor, slug: string, photoId: string): Promise<void> {
    const photo = await this.visible(actor, slug, photoId, true);
    await this.media.remove({ id: photo.id });
  }

  /**
   * Photo publiée du tournoi ; un bénévole n'atteint que les siennes quand
   * il retire (404 sinon, jamais 403).
   */
  private async visible(
    actor: ClubActor,
    slug: string,
    photoId: string,
    ownOnlyForStaff = false,
  ) {
    const tournamentId = await this.tournamentId(actor, slug);
    const photo = await this.prisma.photo.findFirst({
      where: {
        id: photoId,
        tournamentId,
        status: 'READY',
        deletedAt: null,
        hiddenAt: null,
        ...(ownOnlyForStaff && actor.role === 'STAFF'
          ? { uploadedById: actor.userId }
          : {}),
      },
      select: { id: true },
    });
    if (!photo) {
      throw new NotFoundException('Photo introuvable.');
    }
    return photo;
  }

  private async tournamentId(actor: ClubActor, slug: string): Promise<string> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, organization: { slug: actor.organizationSlug } },
      select: { id: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    return tournament.id;
  }
}
