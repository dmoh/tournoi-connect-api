import { Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Envoi effectif d'un email (worker, ou directement sans Redis). */
export abstract class MailSender {
  abstract send(message: MailMessage): Promise<void>;
}

/** Amazon SES, avec le rôle IAM du serveur (aucune clé dans la configuration). */
export class SesMailSender extends MailSender {
  private readonly client: SESv2Client;

  constructor(
    region: string,
    private readonly from: string,
  ) {
    super();
    this.client = new SESv2Client({ region });
  }

  async send(message: MailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              Html: { Data: message.html, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
  }
}

/** Poste local : l'email est écrit dans le journal (le code s'y lit). */
export class LogMailSender extends MailSender {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`À ${message.to} — ${message.subject}\n${message.text}`);
  }
}
