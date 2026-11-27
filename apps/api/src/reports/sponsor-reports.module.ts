import { Global, Module } from '@nestjs/common';
import { PublicSponsorReportsController } from './sponsor-reports.controller.js';
import { SponsorReportsService } from './sponsor-reports.service.js';

/** Bilan automatique des partenaires, le lendemain du tournoi. */
@Global()
@Module({
  controllers: [PublicSponsorReportsController],
  providers: [SponsorReportsService],
  exports: [SponsorReportsService],
})
export class SponsorReportsModule {}
