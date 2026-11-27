import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Env } from '../config/env.js';
import { MAIL_QUEUE } from '../queue/queue.module.js';
import { withBrand } from './brand.js';
import { MailSender, type MailMessage } from './mail-sender.js';

/**
 * Dépose un email dans la file du worker ; sans Redis (tests, poste local),
 * l'envoie directement. Chaque email porte le logo en tête.
 */
@Injectable()
export class Mailer {
  constructor(
    private readonly sender: MailSender,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @InjectQueue(MAIL_QUEUE)
    private readonly queue?: Queue<MailMessage>,
  ) {}

  async send(mail: MailMessage): Promise<void> {
    const message = withBrand(
      mail,
      this.config.get('PUBLIC_APP_URL', { infer: true }),
    );
    if (this.queue) {
      await this.queue.add('send', message);
    } else {
      await this.sender.send(message);
    }
  }
}
