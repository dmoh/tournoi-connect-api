import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PUSH_QUEUE } from '../queue/queue.module.js';
import type { MatchNotification } from './push.schemas.js';
import { PushService } from './push.service.js';

/** Envoie les notifications de match dans le worker. */
@Processor(PUSH_QUEUE)
export class PushProcessor extends WorkerHost {
  constructor(private readonly push: PushService) {
    super();
  }

  async process(job: Job<MatchNotification>): Promise<void> {
    await this.push.deliver(job.data);
  }
}
