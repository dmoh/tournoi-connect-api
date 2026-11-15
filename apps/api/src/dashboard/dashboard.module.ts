import { Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [RegistrationsModule],
  controllers: [DashboardController],
  providers: [DashboardService, OrganizerGuard],
})
export class DashboardModule {}
