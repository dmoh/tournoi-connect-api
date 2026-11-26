import { Global, Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import { BracketController } from './bracket.controller.js';
import { BracketService } from './bracket.service.js';
import { PalmaresController } from '../palmares/palmares.controller.js';
import { PalmaresService } from '../palmares/palmares.service.js';

/**
 * Global : la table de marque fait avancer le tableau à chaque fin de match,
 * puis le palmarès dit si le tournoi est terminé.
 */
@Global()
@Module({
  controllers: [BracketController, PalmaresController],
  providers: [BracketService, PalmaresService, OrganizerGuard],
  exports: [BracketService],
})
export class BracketModule {}
