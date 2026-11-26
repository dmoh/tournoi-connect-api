import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  arrivalSchema,
  forfeitResultSchema,
  matchdaySchema,
  setArrivalSchema,
  type Arrival,
  type ForfeitResult,
  type Matchday,
  type SetArrival,
} from './matchday.schemas.js';
import { MatchdayService } from './matchday.service.js';

/** Lien personnel « Nous sommes arrivés » d'une équipe, sans connexion. */
@ApiTags('public')
@Controller('public/arrivals')
export class PublicArrivalsController {
  constructor(private readonly matchday: MatchdayService) {}

  @Get(':token')
  @RateLimited('arrival')
  @ApiOperation({ summary: 'Équipe et tournoi d’un lien d’arrivée' })
  @ApiOkResponse({ schema: openApi(arrivalSchema) })
  @ApiNotFoundResponse({ description: 'Lien inconnu ou plus valable' })
  view(@Param('token') token: string): Promise<Arrival> {
    return this.matchday.arrival(token);
  }

  @Post(':token')
  @RateLimited('arrival')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Signaler l’arrivée de l’équipe (jour J, un appui, rejouable)',
  })
  @ApiOkResponse({ schema: openApi(arrivalSchema) })
  @ApiNotFoundResponse({ description: 'Lien inconnu ou plus valable' })
  @ApiConflictResponse({ description: 'Pas encore le jour du tournoi' })
  arrive(@Param('token') token: string): Promise<Arrival> {
    return this.matchday.arrive(token);
  }
}

/** Régie du jour J : arrivées et forfaits des équipes. */
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
export class OrganizerMatchdayController {
  constructor(private readonly matchday: MatchdayService) {}

  @Get(':slug/matchday')
  @OrganizerRole('STAFF')
  @ApiOperation({
    summary: 'Équipes du jour J : arrivées, forfaits, prochain match',
  })
  @ApiOkResponse({ schema: openApi(matchdaySchema) })
  @ApiNotFoundResponse({ description: 'Tournoi hors du club' })
  view(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<Matchday> {
    return this.matchday.matchday(req.organizationSlug!, slug);
  }

  @Put(':slug/teams/:code/arrival')
  @OrganizerRole('STAFF')
  @ApiOperation({ summary: 'Pointer l’arrivée d’une équipe (ou la retirer)' })
  @ApiOkResponse({ schema: openApi(matchdaySchema) })
  @ApiNotFoundResponse({
    description: 'Tournoi hors du club ou équipe inconnue',
  })
  setArrival(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Body({ schema: setArrivalSchema }) body: SetArrival,
  ): Promise<Matchday> {
    return this.matchday.setArrival(
      req.organizationSlug!,
      slug,
      code,
      body.arrived,
    );
  }

  @Post(':slug/teams/:code/forfeit')
  @OrganizerRole('ADMIN')
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Déclarer une équipe forfait : ses matchs à venir sont gagnés par l’adversaire (score de forfait du sport)',
  })
  @ApiOkResponse({ schema: openApi(forfeitResultSchema) })
  @ApiNotFoundResponse({
    description: 'Tournoi hors du club, équipe inconnue ou rôle insuffisant',
  })
  @ApiConflictResponse({
    description:
      'Équipe déjà forfait, tournoi terminé ou annulé, ou requête de même clé en cours',
  })
  forfeit(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('code') code: string,
  ): Promise<ForfeitResult> {
    return this.matchday.forfeit(req.organizationSlug!, slug, code);
  }
}
