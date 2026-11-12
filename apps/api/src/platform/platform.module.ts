import { Module } from '@nestjs/common';
import { ModerationService } from '../moderation/moderation.service.js';
import {
  PlatformController,
  PublicReportsController,
} from './platform.controller.js';
import { PlatformGuard } from './platform.guard.js';
import { PlatformService } from './platform.service.js';

@Module({
  controllers: [PublicReportsController, PlatformController],
  providers: [PlatformService, ModerationService, PlatformGuard],
})
export class PlatformModule {}
