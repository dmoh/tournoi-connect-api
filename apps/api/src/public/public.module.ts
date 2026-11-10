import { Module } from '@nestjs/common';
import { AudienceModule } from '../audience/audience.module.js';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';

@Module({
  imports: [AudienceModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
