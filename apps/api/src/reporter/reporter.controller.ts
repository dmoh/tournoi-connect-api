import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  reporterEventSchema,
  reporterMatchSchema,
  reporterStateSchema,
  type ReporterEvent,
  type ReporterMatch,
  type ReporterState,
} from './reporter.schemas.js';
import { ReporterService } from './reporter.service.js';

/**
 * Table de marque (écran 12) : le lien signé tient lieu d'accès, limité à un
 * match et à 24 heures. Un lien invalide ou expiré répond 404.
 */
@ApiTags('reporter')
@ApiNotFoundResponse({ description: 'Lien invalide ou expiré' })
@Controller('reporter')
export class ReporterController {
  constructor(private readonly service: ReporterService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Match ouvert par le lien du rapporteur, avec les effectifs',
  })
  @ApiOkResponse({ schema: openApi(reporterMatchSchema) })
  match(@Param('token') token: string): Promise<ReporterMatch> {
    return this.service.match(token);
  }

  @Post(':token/events')
  @RateLimited('reporterEvent')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Saisie du rapporteur (but, carton, arrêt, photo, période, annulation)',
  })
  @ApiBody({ schema: openApi(reporterEventSchema) })
  @ApiOkResponse({ schema: openApi(reporterStateSchema) })
  record(
    @Param('token') token: string,
    @Body({ schema: reporterEventSchema }) body: ReporterEvent,
  ): Promise<ReporterState> {
    return this.service.record(token, body);
  }
}
