import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { MAINTENANCE_QUEUE } from '../queue/queue.module.js';
import { MaintenanceService, type PurgeReport } from './maintenance.service.js';

/** Identifiant de la planification : la redéclarer ne la duplique pas. */
export const DAILY_PURGE = 'daily-purge';

/** Purge chaque nuit à 4 h (heure de Paris), dans le worker. */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly maintenance: MaintenanceService,
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

  process(_job: Job): Promise<PurgeReport> {
    return this.maintenance.purge();
  }
}
