import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CONVOCATION_QUEUE } from '../queue/queue.module.js';
import { ConvocationsService } from './convocations.service.js';

/** Identifiant de la planification : la redéclarer ne la duplique pas. */
export const CONVOCATION_SWEEP = 'convocation-sweep';

/** Convocations arrivées à échéance, cherchées toutes les heures dans le worker. */
@Processor(CONVOCATION_QUEUE)
export class ConvocationsProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  constructor(
    private readonly convocations: ConvocationsService,
    @InjectQueue(CONVOCATION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      CONVOCATION_SWEEP,
      { pattern: '5 * * * *', tz: 'Europe/Paris' },
      { name: 'sweep' },
    );
  }

  process(): Promise<number> {
    return this.convocations.sweep();
  }
}
