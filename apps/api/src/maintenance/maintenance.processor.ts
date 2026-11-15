import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { MEDIA_CLEANUP_JOB, MediaService } from '../media/media.service.js';
import { MAINTENANCE_QUEUE } from '../queue/queue.module.js';
import { MaintenanceService, type PurgeReport } from './maintenance.service.js';

/** Identifiant de la planification : la redéclarer ne la duplique pas. */
export const DAILY_PURGE = 'daily-purge';

/**
 * Purge chaque nuit à 4 h (heure de Paris), dans le worker ; efface aussi
 * les fichiers des photos retirées, aussitôt demandé (MEDIA_CLEANUP_JOB).
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly media: MediaService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      DAILY_PURGE,
      { pattern: '0 4 * * *', tz: 'Europe/Paris' },
      { name: 'purge' },
    );
  }

  async process(
    job: Job,
  ): Promise<PurgeReport | { expired: number; removed: number }> {
    if (job.name === MEDIA_CLEANUP_JOB) {
      return this.media.cleanup();
    }
    const report = await this.maintenance.purge();
    await this.media.cleanup();
    return report;
  }
}
