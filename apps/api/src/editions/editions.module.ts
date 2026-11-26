import { Global, Module } from '@nestjs/common';
import { PublicEditionInvitesController } from './editions.controller.js';
import { EditionsService } from './editions.service.js';

/** Édition suivante d'un tournoi : brouillon prérempli, invitation des équipes. */
@Global()
@Module({
  controllers: [PublicEditionInvitesController],
  providers: [EditionsService],
  exports: [EditionsService],
})
export class EditionsModule {}
