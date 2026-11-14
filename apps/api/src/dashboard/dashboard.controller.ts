import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerGuard,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import { dashboardSchema, type Dashboard } from './dashboard.schemas.js';
import { DashboardService } from './dashboard.service.js';

/** Pilotage du club ouvert (admins et propriétaire). */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@ApiHeader({
  name: 'X-Organization',
  required: false,
  description: 'Club concerné (slug), si le compte en a plusieurs',
})
@UseGuards(OrganizerGuard)
@Controller('organizer')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Tableau de bord : remplissage, encaissements, audience, versements',
  })
  @ApiOkResponse({ schema: openApi(dashboardSchema) })
  get(@Req() req: OrganizerRequest): Promise<Dashboard> {
    return this.dashboard.dashboard(req.organizationSlug!);
  }

  @Get('tournaments/:slug/export/registrations.csv')
  @ApiOperation({ summary: 'Inscriptions du tournoi (CSV, Excel)' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'Fichier CSV (séparateur « ; », UTF-8)' })
  @ApiNotFoundResponse({ description: 'Tournoi hors du club' })
  async registrations(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const { filename, csv } = await this.dashboard.registrationsCsv(
      req.organizationSlug!,
      slug,
    );
    return this.send(reply, filename, csv);
  }

  @Get('tournaments/:slug/export/players.csv')
  @ApiOperation({ summary: 'Effectifs des équipes du tournoi (CSV, Excel)' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'Fichier CSV (séparateur « ; », UTF-8)' })
  @ApiNotFoundResponse({ description: 'Tournoi hors du club' })
  async players(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const { filename, csv } = await this.dashboard.playersCsv(
      req.organizationSlug!,
      slug,
    );
    return this.send(reply, filename, csv);
  }

  private send(reply: FastifyReply, filename: string, csv: string): string {
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    reply.header('cache-control', 'no-store');
    return csv;
  }
}
