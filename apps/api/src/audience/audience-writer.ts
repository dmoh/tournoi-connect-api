import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Placement } from '../generated/prisma/enums.js';

/** Événement d'audience prêt à cumuler (heure déjà arrondie). */
export interface AudienceJob {
  tournamentSponsorId: string;
  placement: Placement;
  kind: 'impression' | 'click';
  /** Début de l'heure, ISO 8601 UTC. */
  hourBucket: string;
}

/** Ajoute un événement au cumul horaire ; appelé par le worker ou en direct. */
@Injectable()
export class AudienceWriter {
  constructor(private readonly prisma: PrismaService) {}

  async apply(job: AudienceJob): Promise<void> {
    const hourBucket = new Date(job.hourBucket);
    await this.prisma.audienceHourly.upsert({
      where: {
        tournamentSponsorId_placement_hourBucket: {
          tournamentSponsorId: job.tournamentSponsorId,
          placement: job.placement,
          hourBucket,
        },
      },
      create: {
        tournamentSponsorId: job.tournamentSponsorId,
        placement: job.placement,
        hourBucket,
        impressions: job.kind === 'impression' ? 1 : 0,
        clicks: job.kind === 'click' ? 1 : 0,
      },
      update:
        job.kind === 'click'
          ? { clicks: { increment: 1 } }
          : { impressions: { increment: 1 } },
    });
  }
}
