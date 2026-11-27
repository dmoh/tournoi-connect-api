import { Controller, Get, Header, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  sponsorReportSchema,
  type SponsorReport,
} from './sponsor-reports.schemas.js';
import { SponsorReportsService } from './sponsor-reports.service.js';

/** Page de bilan d'un partenaire, ouverte par le lien de l'email, sans connexion. */
@ApiTags('public')
@Controller('public/sponsor-reports')
export class PublicSponsorReportsController {
  constructor(private readonly reports: SponsorReportsService) {}

  @Get(':token')
  @RateLimited('sponsorReport')
  // Lien personnel : jamais gardé par un cache partagé ni par le navigateur.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Bilan d’un partenariat (affichages, clics)' })
  @ApiOkResponse({ schema: openApi(sponsorReportSchema) })
  @ApiNotFoundResponse({ description: 'Lien inconnu' })
  report(@Param('token') token: string): Promise<SponsorReport> {
    return this.reports.report(token);
  }
}
