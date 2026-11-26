import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { REFUND_QUEUE } from '../queue/queue.module.js';
import {
  CancellationsService,
  REFUND_SWEEP_MS,
  type RefundJob,
} from './cancellations.service.js';

/** Identifiant de la planification du rattrapage : la redéclarer ne la duplique pas. */
export const REFUND_SWEEP = 'refund-sweep';

/**
 * Remboursements des annulations par le club, dans le worker : un par
 * inscription (`refund`, déposé par l'API), plus un rattrapage toutes les
 * dix minutes des remboursements restés en attente.
 */
@Processor(REFUND_QUEUE)
export class RefundProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly cancellations: CancellationsService,
    @InjectQueue(REFUND_QUEUE) private readonly queue: Queue<RefundJob>,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      REFUND_SWEEP,
      { every: REFUND_SWEEP_MS },
      { name: 'sweep' },
    );
  }

  async process(job: Job<RefundJob>): Promise<number | string> {
    if (job.name === 'sweep') {
      return this.cancellations.sweep();
    }
    return this.cancellations.refund(job.data.registrationId);
  }
}
