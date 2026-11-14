import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
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

  @Post(':token/photos')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'URL d’envoi signée d’une photo du match (JPEG ou WebP, 2 Mo au plus, sans métadonnées)',
  })
  @ApiBody({ schema: openApi(photoUploadRequestSchema) })
  @ApiOkResponse({ schema: openApi(photoUploadSchema) })
  @ApiTooManyRequestsResponse({ description: 'Limite de photos du match' })
  @ApiServiceUnavailableResponse({ description: 'Stockage non configuré' })
  requestPhoto(
    @Param('token') token: string,
    @Body({ schema: photoUploadRequestSchema }) body: PhotoUploadRequest,
  ): Promise<PhotoUpload> {
    return this.service.requestPhoto(token, body);
  }

  @Post(':token/photos/:photoId/confirm')
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
