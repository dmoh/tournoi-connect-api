import { Global, Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { SponsorInvites } from './sponsor-invites.service.js';
import {
  OrganizerSponsorshipsController,
  PublicSponsorshipsController,
} from './sponsorships.controller.js';
import { SponsorshipsService } from './sponsorships.service.js';

/** Liens et règlement des packs (sans Stripe) : l'invitation et le webhook s'en servent. */
@Global()
@Module({ providers: [SponsorInvites], exports: [SponsorInvites] })
export class SponsorInvitesModule {}

/** Paiement en ligne des packs sponsors (Stripe Checkout sur le compte du club). */
@Module({
  imports: [RegistrationsModule],
  controllers: [PublicSponsorshipsController, OrganizerSponsorshipsController],
  providers: [SponsorshipsService, OrganizerGuard],
})
export class SponsorshipsModule {}
