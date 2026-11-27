import { Global, Module } from '@nestjs/common';
import { PublicSponsorReportsController } from './sponsor-reports.controller.js';
import { SponsorReportsService } from './sponsor-reports.service.js';
import { TeamRecapsService } from './team-recaps.service.js';

/** Le lendemain du tournoi : bilan des partenaires et récapitulatif des équipes. */
@Global()
@Module({
  controllers: [PublicSponsorReportsController],
  providers: [SponsorReportsService, TeamRecapsService],
  exports: [SponsorReportsService, TeamRecapsService],
})
export class SponsorReportsModule {}
