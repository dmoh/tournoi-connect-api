import { Global, Module } from '@nestjs/common';
import { FollowsController, PushController } from './push.controller.js';
import { PushSender } from './push-sender.js';
import { PushService } from './push.service.js';

@Global()
@Module({
  controllers: [PushController, FollowsController],
  providers: [PushService, PushSender],
  exports: [PushService],
})
export class PushModule {}
