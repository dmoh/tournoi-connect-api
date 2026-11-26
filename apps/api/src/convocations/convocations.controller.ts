import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  OrganizerGuard,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  calendarQuerySchema,
  convocationStatusSchema,
  type CalendarQuery,
  type ConvocationStatus,
} from './convocations.schemas.js';
import { ConvocationsService } from './convocations.service.js';

/** Calendrier public d'une équipe (abonnement d'agenda). */
@ApiTags('public')
@Controller('public/tournaments')
export class PublicCalendarController {
  constructor(private readonly convocations: ConvocationsService) {}

  @Get(':slug/calendar.ics')
  @RateLimited('calendar')
  @ApiOperation({
    summary:
      'Calendrier iCalendar des matchs d’une équipe (team), ou du tournoi : à ajouter en abonnement (webcal)',
  })
  @ApiProduces('text/calendar')
  @ApiOkResponse({ description: 'Calendrier iCalendar (RFC 5545)' })
  @ApiNotFoundResponse({ description: 'Tournoi ou équipe introuvable' })
  async calendar(
    @Param('slug') slug: string,
    @Query({ schema: calendarQuerySchema }) query: CalendarQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const ics = await this.convocations.calendar(slug, query.team);
    if (ics === null) {
      throw new NotFoundException('Tournoi ou équipe introuvable.');
    }
    reply.header('content-type', 'text/calendar; charset=utf-8');
    reply.header(
      'content-disposition',
      `inline; filename="${slug}${query.team ? `-${query.team}` : ''}.ics"`,
    );
    // Les agendas relisent toutes les heures ; un cache court suffit.
    reply.header('cache-control', 'public, max-age=300');
    return ics;
  }
}

/** Convocations des équipes d'un tournoi du club. */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@ApiHeader({
  name: 'X-Organization',
  required: false,
  description: 'Club concerné (slug), si le compte en a plusieurs',
})
@UseGuards(OrganizerGuard)
@Controller('organizer/tournaments')
export class OrganizerConvocationsController {
  constructor(private readonly convocations: ConvocationsService) {}

  @Get(':slug/convocations')
  @ApiOperation({
    summary:
      'Convocations : envoyées ou date de l’envoi automatique (48 h avant, 24 h sans tirage), équipes prévenues',
  })
  @ApiOkResponse({ schema: openApi(convocationStatusSchema) })
  @ApiNotFoundResponse({ description: 'Tournoi hors du club' })
  status(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<ConvocationStatus> {
    return this.convocations.status(req.organizationSlug!, slug);
  }

  @Post(':slug/convocations')
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Envoyer les convocations maintenant (ou de nouveau, après un changement d’horaires)',
  })
  @ApiOkResponse({ schema: openApi(convocationStatusSchema) })
  @ApiNotFoundResponse({ description: 'Tournoi hors du club' })
  @ApiConflictResponse({
    description:
      'Tournoi terminé, annulé ou en brouillon, ou requête de même clé encore en cours',
  })
  send(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<ConvocationStatus> {
    return this.convocations.sendNow(req.organizationSlug!, slug);
  }
}
