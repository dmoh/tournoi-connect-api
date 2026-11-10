import { Module } from '@nestjs/common';
import { ReporterModule } from '../reporter/reporter.module.js';
import { OrganizerGuard } from './organizer.guard.js';
import { OrganizerController } from './organizer.controller.js';
import { OrganizerService } from './organizer.service.js';

@Module({
  imports: [ReporterModule],
  controllers: [OrganizerController],
  providers: [OrganizerService, OrganizerGuard],
})
export class OrganizerModule {}
