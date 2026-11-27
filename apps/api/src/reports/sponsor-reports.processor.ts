import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { REPORT_QUEUE } from '../queue/queue.module.js';
import { SponsorReportsService } from './sponsor-reports.service.js';
import { TeamRecapsService } from './team-recaps.service.js';

/** Identifiant de la planification : la redéclarer ne la duplique pas. */
export const REPORT_SWEEP = 'sponsor-report-sweep';

/**
 * Envois du lendemain cherchés toutes les heures dans le worker : bilans des
 * partenaires, puis récapitulatifs des équipes. Les deux passent, puis un
 * échec fait échouer le travail (relance).
 */
@Processor(REPORT_QUEUE)
export class SponsorReportsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly reports: SponsorReportsService,
    private readonly recaps: TeamRecapsService,
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

  async process(): Promise<number> {
    const [reports, recaps] = await Promise.allSettled([
      this.reports.sweep(),
      this.recaps.sweep(),
    ]);
    const failure = [reports, recaps].find((r) => r.status === 'rejected');
    if (failure) {
      throw failure.reason;
    }
    return (
      (reports.status === 'fulfilled' ? reports.value : 0) +
      (recaps.status === 'fulfilled' ? recaps.value : 0)
    );
  }
}
