import { Injectable, NotFoundException } from '@nestjs/common';
import type { Page } from '../common/pagination.js';
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

  async list(
    slug: string,
    query: PublicPhotosQuery,
  ): Promise<Page<PublicPhoto>> {
    const tournament = await this.prisma.tournament.findFirst({
      where: { slug, status: { in: [...PUBLIC_STATUSES] }, hiddenAt: null },
      select: { id: true },
    });
    if (!tournament) {
      throw new NotFoundException('Tournoi introuvable.');
    }
    // Curseur lié aux filtres : il ne sert que pour la même galerie.
    return this.media.list(
      {
        tournamentId: tournament.id,
        ...(query.match ? { match: { code: query.match } } : {}),
        ...(query.highlights ? { highlight: true } : {}),
      },
      `photos:public:${query.match ?? ''}:${query.highlights ? 'highlights' : 'all'}`,
      query,
    );
  }
}
