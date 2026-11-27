import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { REPORT_QUEUE } from '../queue/queue.module.js';
import { SponsorReportsService } from './sponsor-reports.service.js';

/** Identifiant de la planification : la redéclarer ne la duplique pas. */
export const REPORT_SWEEP = 'sponsor-report-sweep';

/** Bilans des partenaires arrivés à échéance, cherchés toutes les heures dans le worker. */
@Processor(REPORT_QUEUE)
export class SponsorReportsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly reports: SponsorReportsService,
    @InjectQueue(REPORT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      REPORT_SWEEP,
      { pattern: '20 * * * *', tz: 'Europe/Paris' },
      { name: 'sweep' },
    );
  }

  process(): Promise<number> {
    return this.reports.sweep();
  }
}
