import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PUBLIC_STATUSES } from '../public/public-mapping.js';
import type { PublicPhoto, PublicPhotosQuery } from './media.schemas.js';
import { MediaService } from './media.service.js';

@Injectable()
export class PublicPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async list(slug: string, query: PublicPhotosQuery): Promise<PublicPhoto[]> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      select: { id: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    const photos = await this.media.list(
      {
        tournamentId: tournament.id,
        ...(query.match ? { match: { code: query.match } } : {}),
        ...(query.highlights ? { highlight: true } : {}),
      },
      query.limit,
    );
    return photos.map((p) => this.media.toPublic(p));
  }
}
