import { Global, Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import { BracketController } from './bracket.controller.js';
import { BracketService } from './bracket.service.js';

/** Global : la table de marque fait avancer le tableau à chaque fin de match. */
@Global()
@Module({
  controllers: [BracketController],
  providers: [BracketService, OrganizerGuard],
  exports: [BracketService],
})
export class BracketModule {}
