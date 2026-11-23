import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { WAITLIST_QUEUE } from '../queue/queue.module.js';
import {
  WAITLIST_SWEEP_MS,
  WaitlistService,
  type WaitlistJob,
} from './waitlist.service.js';

/** Identifiant de la planification du balayage : la redéclarer ne la duplique pas. */
export const WAITLIST_SWEEP = 'waitlist-sweep';

/**
 * Promeut la liste d'attente dans le worker : à chaque place rendue
 * (`promote`, déposé par l'API), à l'échéance d'une place proposée (même
 * tâche, différée de 48 heures) et toutes les dix minutes en rattrapage.
 */
@Processor(WAITLIST_QUEUE)
export class WaitlistProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly waitlist: WaitlistService,
    @InjectQueue(WAITLIST_QUEUE) private readonly queue: Queue<WaitlistJob>,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      WAITLIST_SWEEP,
      { every: WAITLIST_SWEEP_MS },
      { name: 'sweep' },
    );
  }

  async process(job: Job<WaitlistJob>): Promise<number | string[]> {
    if (job.name === 'sweep') {
      return this.waitlist.sweep();
    }
    return this.waitlist.promote(job.data.tournamentId);
  }
}
