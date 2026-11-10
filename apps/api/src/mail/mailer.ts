import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MAIL_QUEUE } from '../queue/queue.module.js';
import { MailSender, type MailMessage } from './mail-sender.js';

/**
 * Dépose un email dans la file du worker ; sans Redis (tests, poste local),
 * l'envoie directement.
 */
@Injectable()
export class Mailer {
  constructor(
    private readonly sender: MailSender,
    @Optional()
    @InjectQueue(MAIL_QUEUE)
    private readonly queue?: Queue<MailMessage>,
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (this.queue) {
      await this.queue.add('send', message);
    } else {
      await this.sender.send(message);
    }
  }
}
