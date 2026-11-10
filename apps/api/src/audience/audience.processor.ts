import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AUDIENCE_QUEUE } from '../queue/queue.module.js';
import { AudienceWriter, type AudienceJob } from './audience-writer.js';

/** Traite la file d'audience dans le worker. */
@Processor(AUDIENCE_QUEUE)
export class AudienceProcessor extends WorkerHost {
  constructor(private readonly writer: AudienceWriter) {
    super();
  }

  async process(job: Job<AudienceJob>): Promise<void> {
    await this.writer.apply(job.data);
  }
}
