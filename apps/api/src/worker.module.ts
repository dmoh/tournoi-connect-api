import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AudienceModule } from './audience/audience.module.js';
import { AudienceProcessor } from './audience/audience.processor.js';
import { ConvocationsProcessor } from './convocations/convocations.processor.js';
import { EditionsProcessor } from './editions/editions.processor.js';
import { MailProcessor } from './mail/mail.processor.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { MaintenanceProcessor } from './maintenance/maintenance.processor.js';
import { PushProcessor } from './push/push.processor.js';
import { RefundProcessor } from './registrations/refund.processor.js';
import { RegistrationsModule } from './registrations/registrations.module.js';
import { WaitlistProcessor } from './registrations/waitlist.processor.js';

/**
 * Contexte du worker : l'application complète plus les processeurs BullMQ,
 * enregistrés seulement si Redis est configuré.
 */
@Module({
  imports: [AppModule, AudienceModule, MaintenanceModule, RegistrationsModule],
  providers: process.env['REDIS_URL']
    ? [
        AudienceProcessor,
        ConvocationsProcessor,
        EditionsProcessor,
        MailProcessor,
        MaintenanceProcessor,
        PushProcessor,
        RefundProcessor,
        WaitlistProcessor,
      ]
    : [],
})
export class WorkerModule {}
