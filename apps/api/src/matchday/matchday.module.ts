import { Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import {
  OrganizerMatchdayController,
  PublicArrivalsController,
} from './matchday.controller.js';
import { MatchdayService } from './matchday.service.js';

/** Jour J : arrivées des équipes et forfaits. */
@Module({
  controllers: [PublicArrivalsController, OrganizerMatchdayController],
  providers: [MatchdayService, OrganizerGuard],
  exports: [MatchdayService],
})
export class MatchdayModule {}
