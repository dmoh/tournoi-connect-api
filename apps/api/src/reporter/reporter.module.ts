import { Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import {
  ReporterController,
  ReporterLinksController,
} from './reporter.controller.js';
import { ReporterService } from './reporter.service.js';

@Module({
  controllers: [ReporterController, ReporterLinksController],
  providers: [ReporterService, OrganizerGuard],
  exports: [ReporterService],
})
export class ReporterModule {}
