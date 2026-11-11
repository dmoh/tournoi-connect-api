import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { Clock, SystemClock } from './common/clock.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { OrganizerModule } from './organizer/organizer.module.js';
import { ClubsModule } from './clubs/clubs.module.js';
import { RegistrationsModule } from './registrations/registrations.module.js';
import { PublicModule } from './public/public.module.js';
import { ReporterModule } from './reporter/reporter.module.js';
import { QueueModule } from './queue/queue.module.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    QueueModule.forRoot(),
    MailModule,
    AuthModule,
    HealthModule,
    PublicModule,
    OrganizerModule,
    ClubsModule,
    RegistrationsModule,
    ReporterModule,
  ],
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class AppModule {}
