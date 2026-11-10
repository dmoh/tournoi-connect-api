import { Module } from '@nestjs/common';
import { ReporterModule } from '../reporter/reporter.module.js';
import { OrganizerTokenGuard } from './organizer-token.guard.js';
import { OrganizerController } from './organizer.controller.js';
import { OrganizerService } from './organizer.service.js';

@Module({
  imports: [ReporterModule],
  controllers: [OrganizerController],
  providers: [OrganizerService, OrganizerTokenGuard],
})
export class OrganizerModule {}
