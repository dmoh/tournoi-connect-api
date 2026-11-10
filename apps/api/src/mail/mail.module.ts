import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { LogMailSender, MailSender, SesMailSender } from './mail-sender.js';
import { Mailer } from './mailer.js';

@Global()
@Module({
  providers: [
    {
      provide: MailSender,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('MAIL_TRANSPORT', { infer: true }) === 'ses'
          ? new SesMailSender(
              config.get('AWS_REGION', { infer: true }),
              config.get('MAIL_FROM', { infer: true }),
            )
          : new LogMailSender(),
    },
    Mailer,
  ],
  exports: [MailSender, Mailer],
})
export class MailModule {}
