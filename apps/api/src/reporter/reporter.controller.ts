import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  photoUploadRequestSchema,
  photoUploadSchema,
  publicPhotoSchema,
  type PhotoUpload,
  type PhotoUploadRequest,
  type PublicPhoto,
} from '../media/media.schemas.js';
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
 * match et à 24 heures. Un lien invalide, expiré ou révoqué répond 404.
 */
@ApiTags('reporter')
@ApiNotFoundResponse({ description: 'Lien invalide, expiré ou révoqué' })
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
  @ApiConflictResponse({
    description:
      'Tournoi plus public, match terminé (seule la fin s’annule), annulation impossible, ou clientEventId déjà utilisé pour une autre saisie',
  })
  record(
    @Param('token') token: string,
    @Body({ schema: reporterEventSchema }) body: ReporterEvent,
  ): Promise<ReporterState> {
    return this.service.record(token, body);
  }

  @Post(':token/photos')
  @RateLimited('reporterPhoto')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'URL d’envoi signée d’une photo du match (JPEG ou WebP, 2 Mo au plus, sans métadonnées)',
  })
  @ApiBody({ schema: openApi(photoUploadRequestSchema) })
  @ApiOkResponse({ schema: openApi(photoUploadSchema) })
  @ApiTooManyRequestsResponse({
    description: 'Limite de photos du match, ou trop de requêtes',
  })
  @ApiServiceUnavailableResponse({ description: 'Stockage non configuré' })
  requestPhoto(
    @Param('token') token: string,
    @Body({ schema: photoUploadRequestSchema }) body: PhotoUploadRequest,
  ): Promise<PhotoUpload> {
    return this.service.requestPhoto(token, body);
  }

  @Post(':token/photos/:photoId/confirm')
  @RateLimited('reporterPhoto')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Publie la photo une fois envoyée et vérifiée (à joindre ensuite à un événement PHOTO)',
  })
  @ApiOkResponse({ schema: openApi(publicPhotoSchema) })
  @ApiConflictResponse({ description: 'Fichier pas encore arrivé' })
  @ApiUnprocessableEntityResponse({ description: 'Fichier non conforme' })
  confirmPhoto(
    @Param('token') token: string,
    @Param('photoId') photoId: string,
  ): Promise<PublicPhoto> {
    return this.service.confirmPhoto(token, photoId);
  }
}

/** Liens rapporteur d'un match, côté club : révocation (dès bénévole, comme l'émission). */
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
export class ReporterLinksController {
  constructor(private readonly service: ReporterService) {}

  @Delete('tournaments/:slug/matches/:matchId/reporter-links')
  @OrganizerRole('STAFF')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Révoquer tous les liens de la table de marque d’un match',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Match hors de l’organisation' })
  revoke(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('matchId') matchId: string,
  ): Promise<void> {
    return this.service.revokeLinks(req.organizationSlug!, slug, matchId);
  }
}
