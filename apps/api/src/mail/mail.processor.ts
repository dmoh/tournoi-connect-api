import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MAIL_QUEUE } from '../queue/queue.module.js';
import { MailSender, type MailMessage } from './mail-sender.js';

/** Envoie les emails de la file dans le worker (5 essais, délai croissant). */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(private readonly sender: MailSender) {
    super();
  }

  async process(job: Job<MailMessage>): Promise<void> {
    await this.sender.send(job.data);
  }
}
