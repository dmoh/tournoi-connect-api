import { Module } from '@nestjs/common';
import { OrganizerTokenGuard } from './organizer-token.guard.js';
import { OrganizerController } from './organizer.controller.js';
import { OrganizerService } from './organizer.service.js';

@Module({
  controllers: [OrganizerController],
  providers: [OrganizerService, OrganizerTokenGuard],
})
export class OrganizerModule {}
