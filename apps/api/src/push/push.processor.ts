import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PUSH_QUEUE } from '../queue/queue.module.js';
import type { PushNotification } from './push.schemas.js';
import { PushService } from './push.service.js';

/**
 * Envoie les notifications dans le worker : quelques tâches à la fois,
 * chacune envoyée par tranches parallèles (PushService.deliver pour un
 * match, deliverToUser pour les appareils d'un compte).
 */
@Processor(PUSH_QUEUE, { concurrency: 4 })
export class PushProcessor extends WorkerHost {
  constructor(private readonly push: PushService) {
    super();
  }

  async process(job: Job<PushNotification>): Promise<void> {
    if (job.data.kind === 'user') {
      await this.push.deliverToUser(job.data);
      return;
    }
    await this.push.deliver(job.data);
  }
}
