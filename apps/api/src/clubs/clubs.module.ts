import { Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import {
  ClubsController,
  InvitationsController,
  MembersController,
} from './clubs.controller.js';
import { ClubsService } from './clubs.service.js';

@Module({
  controllers: [ClubsController, MembersController, InvitationsController],
  providers: [ClubsService, OrganizerGuard],
})
export class ClubsModule {}
