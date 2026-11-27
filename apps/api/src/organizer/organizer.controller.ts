import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { openApi } from '../common/openapi-schema.js';
import {
  pageQuerySchema,
  type Page,
  type PageQuery,
} from '../common/pagination.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from './organizer.guard.js';
import {
  createdPostSchema,
  createPostSchema,
  createTournamentSchema,
  invitedSponsorSchema,
  inviteSponsorSchema,
  nextEditionSchema,
  organizerSponsorsSchema,
  organizerTournamentPageSchema,
  organizerTournamentSchema,
  scheduleResultSchema,
  scheduleSchema,
  updateSponsorSchema,
  type CreatedPost,
  type CreatePost,
  type CreateTournament,
  type InvitedSponsor,
  type InviteSponsor,
  type NextEdition,
  type OrganizerSponsors,
  type OrganizerTournament,
  type Schedule,
  type ScheduleResult,
  type UpdateSponsor,
} from './organizer.schemas.js';
import { OrganizerService } from './organizer.service.js';
import { EditionsService } from '../editions/editions.service.js';
import {
  reporterLinkSchema,
  type ReporterLink,
} from '../reporter/reporter.schemas.js';
import { ReporterService } from '../reporter/reporter.service.js';

/** Espace organisateur : sponsors, packs et annonces d'un tournoi de son organisation. */
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
export class OrganizerController {
  constructor(
    private readonly service: OrganizerService,
    private readonly reporter: ReporterService,
    private readonly editions: EditionsService,
  ) {}

  @Post('tournaments/:slug/matches/:matchId/reporter-link')
  @OrganizerRole('STAFF')
  @ApiOperation({
    summary: 'Lien de la table de marque d’un match, valable 24 heures',
  })
  @ApiCreatedResponse({ schema: openApi(reporterLinkSchema) })
  @ApiNotFoundResponse({ description: 'Match hors de l’organisation' })
  reporterLink(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('matchId') matchId: string,
  ): Promise<ReporterLink> {
    return this.reporter.issueLink(
      req.organizationSlug!,
      req.user!.id,
      slug,
      matchId,
    );
  }

  @Get('tournaments')
  @OrganizerRole('STAFF')
  @ApiOperation({
    summary: 'Écran 01 : les tournois de l’organisation (lecture dès bénévole)',
  })
  @ApiOkResponse({ schema: openApi(organizerTournamentPageSchema) })
  @ApiBadRequestResponse({ description: 'Limite ou curseur invalide' })
  tournaments(
    @Req() req: OrganizerRequest,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ): Promise<Page<OrganizerTournament>> {
    return this.service.tournaments(req.organizationSlug!, query);
  }

  @Post('tournaments')
  @Idempotent()
  @ApiOperation({
    summary: 'Publier le tournoi de l’assistant de création (écrans 02 à 05)',
  })
  @ApiConflictResponse({ description: 'Requête de même clé encore en cours' })
  @ApiBody({ schema: openApi(createTournamentSchema) })
  @ApiCreatedResponse({ schema: openApi(organizerTournamentSchema) })
  createTournament(
    @Req() req: OrganizerRequest,
    @Body({ schema: createTournamentSchema }) body: CreateTournament,
  ): Promise<OrganizerTournament> {
    return this.service.createTournament(req.organizationSlug!, body);
  }

  @Get('tournaments/:slug/next-edition')
  @ApiOperation({
    summary:
      'Édition suivante : brouillon complet de l’assistant (52 semaines plus tard) et équipes à inviter',
  })
  @ApiOkResponse({ schema: openApi(nextEditionSchema) })
  @ApiNotFoundResponse({ description: 'Tournoi hors de l’organisation' })
  nextEdition(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<NextEdition> {
    return this.editions.nextEdition(req.organizationSlug!, slug);
  }

  @Put('tournaments/:slug/schedule')
  @ApiOperation({
    summary:
      'Écran 07 : publier le planning (terrain et heure des matchs à venir)',
  })
  @ApiBody({ schema: openApi(scheduleSchema) })
  @ApiOkResponse({ schema: openApi(scheduleResultSchema) })
  @ApiNotFoundResponse({
    description: 'Tournoi ou match hors de l’organisation',
  })
  @ApiConflictResponse({ description: 'Match déjà commencé' })
  saveSchedule(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Body({ schema: scheduleSchema }) body: Schedule,
  ): Promise<ScheduleResult> {
    return this.service.saveSchedule(req.organizationSlug!, slug, body);
  }

  @Get('tournaments/:slug/sponsors')
  @ApiOperation({
    summary: 'Écran 09 : packs, sponsors du tournoi et prospects du club',
  })
  @ApiOkResponse({ schema: openApi(organizerSponsorsSchema) })
  @ApiNotFoundResponse({ description: 'Tournoi hors de l’organisation' })
  sponsors(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<OrganizerSponsors> {
    return this.service.sponsors(req.organizationSlug!, slug);
  }

  @Post('tournaments/:slug/sponsors')
  @Idempotent()
  @ApiOperation({ summary: 'Inviter un sponsor à prendre un pack' })
  @ApiBody({ schema: openApi(inviteSponsorSchema) })
  @ApiCreatedResponse({ schema: openApi(invitedSponsorSchema) })
  @ApiConflictResponse({
    description:
      'Pack épuisé, sponsor déjà présent ou requête de même clé en cours',
  })
  invite(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Body({ schema: inviteSponsorSchema }) body: InviteSponsor,
  ): Promise<InvitedSponsor> {
    return this.service.invite(req.organizationSlug!, slug, body);
  }

  @Patch('tournament-sponsors/:id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Marquer un sponsor payé (paiement hors Stripe) ou de nouveau invité',
  })
  @ApiBody({ schema: openApi(updateSponsorSchema) })
  @ApiNoContentResponse()
  update(
    @Req() req: OrganizerRequest,
    @Param('id') id: string,
    @Body({ schema: updateSponsorSchema }) body: UpdateSponsor,
  ): Promise<void> {
    return this.service.updateSponsor(req.organizationSlug!, id, body);
  }

  @Post('tournaments/:slug/posts')
  @Idempotent()
  @ApiOperation({
    summary: 'Publier une annonce ou un sondage dans le fil News',
  })
  @ApiConflictResponse({ description: 'Requête de même clé encore en cours' })
  @ApiBody({ schema: openApi(createPostSchema) })
  @ApiCreatedResponse({ schema: openApi(createdPostSchema) })
  createPost(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Body({ schema: createPostSchema }) body: CreatePost,
  ): Promise<CreatedPost> {
    return this.service.createPost(req.organizationSlug!, slug, body);
  }
}
