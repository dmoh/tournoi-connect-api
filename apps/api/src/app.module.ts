import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { Clock, SystemClock } from './common/clock.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { OrganizerModule } from './organizer/organizer.module.js';
import { PublicModule } from './public/public.module.js';
import { QueueModule } from './queue/queue.module.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    QueueModule.forRoot(),
    HealthModule,
    PublicModule,
    OrganizerModule,
  ],
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class AppModule {}
