import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/auth.guard.js';
import { openApi } from '../common/openapi-schema.js';
import {
  createReportSchema,
  platformReportSchema,
  reportCreatedSchema,
  reportListQuerySchema,
  type CreateReport,
  type PlatformReport,
  type ReportListQuery,
} from '../moderation/moderation.schemas.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { PlatformGuard } from './platform.guard.js';
import {
  platformOverviewSchema,
  type PlatformOverview,
} from './platform.schemas.js';
import { PlatformService } from './platform.service.js';

/** Signaler un contenu public, connecté ou non. */
@ApiTags('public')
@Controller('public/tournaments/:slug/reports')
export class PublicReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Signaler la page d’un tournoi ou l’une de ses actualités',
  })
  @ApiBody({ schema: openApi(createReportSchema) })
  @ApiOkResponse({ schema: openApi(reportCreatedSchema) })
  @ApiNotFoundResponse({ description: 'Tournoi ou actualité introuvable' })
  @ApiTooManyRequestsResponse({
    description: 'Trop de signalements en une heure',
  })
  report(
    @Param('slug') slug: string,
    @Body({ schema: createReportSchema }) body: CreateReport,
  ): Promise<{ id: string }> {
    return this.moderation.report(slug, body);
  }
}

/** Espace plateforme : activité, services et modération (admins de la plateforme). */
@ApiTags('platform')
@ApiBearerAuth()
@ApiNotFoundResponse({ description: 'Réservé aux admins de la plateforme' })
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Indicateurs et état des services' })
  @ApiOkResponse({ schema: openApi(platformOverviewSchema) })
  overview(): Promise<PlatformOverview> {
    return this.platform.overview();
  }

  @Get('reports')
  @ApiOperation({ summary: 'Signalements (ouverts par défaut)' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['OPEN', 'HIDDEN', 'DISMISSED'],
  })
  @ApiOkResponse({ schema: openApi(z.array(platformReportSchema)) })
  reports(
    @Query({ schema: reportListQuerySchema }) query: ReportListQuery,
  ): Promise<PlatformReport[]> {
    return this.moderation.list(query);
  }

  @Post('reports/:id/hide')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Masquer le contenu signalé et prévenir le club',
  })
  @ApiNoContentResponse()
  hide(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.moderation.hide(id, user.id);
  }

  @Post('reports/:id/dismiss')
  @HttpCode(204)
  @ApiOperation({ summary: 'Écarter le signalement (rien à retirer)' })
  @ApiNoContentResponse()
  dismiss(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.moderation.dismiss(id, user.id);
  }
}
