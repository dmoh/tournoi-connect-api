import { Global, Module } from '@nestjs/common';
import { EditionsService } from './editions.service.js';

/** Édition suivante d'un tournoi : brouillon prérempli, invitation des équipes. */
@Global()
@Module({
  providers: [EditionsService],
  exports: [EditionsService],
})
export class EditionsModule {}
