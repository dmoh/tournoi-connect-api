import { Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AudienceModule } from './audience/audience.module.js';
import { AudienceProcessor } from './audience/audience.processor.js';

/**
 * Contexte du worker : l'application complète plus les processeurs BullMQ,
 * enregistrés seulement si Redis est configuré.
 */
@Module({
  imports: [AppModule, AudienceModule],
  providers: process.env['REDIS_URL'] ? [AudienceProcessor] : [],
})
export class WorkerModule {}
