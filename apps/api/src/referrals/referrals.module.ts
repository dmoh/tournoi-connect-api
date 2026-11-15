import { Global, Module } from '@nestjs/common';
import {
  OrganizerReferralController,
  PublicReferralController,
} from './referrals.controller.js';
import { ReferralsService } from './referrals.service.js';

@Global()
@Module({
  controllers: [OrganizerReferralController, PublicReferralController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
