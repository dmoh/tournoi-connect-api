import { Global, Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import {
  OrganizerConvocationsController,
  PublicCalendarController,
} from './convocations.controller.js';
import { ConvocationsService } from './convocations.service.js';

/** Convocations des équipes et calendrier d'agenda. */
@Global()
@Module({
  controllers: [PublicCalendarController, OrganizerConvocationsController],
  providers: [ConvocationsService, OrganizerGuard],
  exports: [ConvocationsService],
})
export class ConvocationsModule {}
