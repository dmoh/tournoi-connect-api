import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerTokenGuard,
  type OrganizerRequest,
} from './organizer-token.guard.js';
import {
  createPostSchema,
  createdPostSchema,
  inviteSponsorSchema,
  organizerSponsorsSchema,
  sponsorRowSchema,
  updateSponsorSchema,
  type CreatePost,
  type CreatedPost,
  type InviteSponsor,
  type OrganizerSponsors,
  type SponsorRow,
  type UpdateSponsor,
} from './organizer.schemas.js';
import { OrganizerService } from './organizer.service.js';

/** Espace organisateur : sponsors, packs et annonces d'un tournoi de son organisation. */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Jeton absent ou invalide' })
@UseGuards(OrganizerTokenGuard)
@Controller('organizer')
export class OrganizerController {
  constructor(private readonly service: OrganizerService) {}

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
  @ApiOperation({ summary: 'Inviter un sponsor à prendre un pack' })
  @ApiBody({ schema: openApi(inviteSponsorSchema) })
  @ApiCreatedResponse({ schema: openApi(sponsorRowSchema) })
  @ApiConflictResponse({ description: 'Pack épuisé ou sponsor déjà présent' })
  invite(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Body({ schema: inviteSponsorSchema }) body: InviteSponsor,
  ): Promise<SponsorRow> {
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
  @ApiOperation({
    summary: 'Publier une annonce ou un sondage dans le fil News',
  })
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
