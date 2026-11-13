import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountModule } from './account/account.module.js';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { Clock, SystemClock } from './common/clock.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MailModule } from './mail/mail.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { ReferralsModule } from './referrals/referrals.module.js';
import { OrganizerModule } from './organizer/organizer.module.js';
import { ClubsModule } from './clubs/clubs.module.js';
import { RegistrationsModule } from './registrations/registrations.module.js';
import { PushModule } from './push/push.module.js';
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
    AccountModule,
    HealthModule,
    PublicModule,
    OrganizerModule,
    ClubsModule,
    RegistrationsModule,
    PushModule,
    ReporterModule,
    MaintenanceModule,
    PlatformModule,
    ReferralsModule,
  ],
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class AppModule {}
