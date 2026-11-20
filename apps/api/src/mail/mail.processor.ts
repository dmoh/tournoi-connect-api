import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MAIL_QUEUE } from '../queue/queue.module.js';
import { MailSender, type MailMessage } from './mail-sender.js';

const EMAIL = /[^\s<>'"/]+@[^\s<>'"/]+\.[a-z]{2,}/gi;

/** Adresses masquées : le journal garde la cause de l'échec, pas le destinataire. */
export function maskEmails(text: string): string {
  return text.replace(
    EMAIL,
    (address) => `${address[0]}***@${address.split('@')[1]}`,
  );
}

/** Envoie les emails de la file dans le worker (5 essais, délai croissant). */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger('Mail');

  constructor(private readonly sender: MailSender) {
    super();
  }

  async process(job: Job<MailMessage>): Promise<void> {
    await this.sender.send(job.data);
  }

  /**
   * Un échec d'envoi (refus SES, droit IAM manquant…) laisse sinon la file
   * muette : seul Redis en gardait la trace. Le dernier essai part en erreur.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<MailMessage> | undefined, error: Error): void {
    const attempts = job?.opts.attempts ?? 1;
    const made = job?.attemptsMade ?? attempts;
    const final = made >= attempts;
    const message = `Email ${job?.id ?? '?'} non envoyé (essai ${made}/${attempts}${final ? ', abandon' : ''}) : ${error.name} : ${maskEmails(error.message)}`;
    if (final) {
      this.logger.error(message);
    } else {
      this.logger.warn(message);
    }
  }
}
