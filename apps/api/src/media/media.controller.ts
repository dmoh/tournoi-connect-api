import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import { ClubPhotosService, type ClubActor } from './club-photos.service.js';
import {
  clubPhotoSchema,
  clubPhotoUploadRequestSchema,
  photoUploadSchema,
  publicPhotoSchema,
  publicPhotosQuerySchema,
  updatePhotoSchema,
  type ClubPhoto,
  type ClubPhotoUploadRequest,
  type PhotoUpload,
  type PublicPhoto,
  type PublicPhotosQuery,
  type UpdatePhoto,
} from './media.schemas.js';
import { PublicPhotosService } from './public-photos.service.js';

const actorOf = (req: OrganizerRequest): ClubActor => ({
  organizationSlug: req.organizationSlug!,
  userId: req.user!.id,
  role: req.memberRole!,
});

/** Photos du club sur un tournoi (bénévoles compris). */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@ApiNotFoundResponse({ description: 'Tournoi ou photo hors du club' })
@ApiHeader({
  name: 'X-Organization',
  required: false,
  description: 'Club concerné (slug), si le compte en a plusieurs',
})
@UseGuards(OrganizerGuard)
@OrganizerRole('STAFF')
@Controller('organizer/tournaments/:slug/photos')
export class ClubPhotosController {
  constructor(private readonly photos: ClubPhotosService) {}

  @Get()
  @ApiOperation({ summary: 'Photos publiées du tournoi' })
  @ApiOkResponse({ schema: openApi(z.array(clubPhotoSchema)) })
  list(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<ClubPhoto[]> {
    return this.photos.list(actorOf(req), slug);
  }

  @Post()
  @ApiOperation({
    summary:
      'URL d’envoi signée d’une photo (JPEG ou WebP, 2 Mo au plus, sans métadonnées)',
  })
  @ApiBody({ schema: openApi(clubPhotoUploadRequestSchema) })
  @ApiOkResponse({ schema: openApi(photoUploadSchema) })
  @ApiTooManyRequestsResponse({ description: 'Limite de photos atteinte' })
  @ApiServiceUnavailableResponse({ description: 'Stockage non configuré' })
  @HttpCode(200)
  upload(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Body({ schema: clubPhotoUploadRequestSchema })
    body: ClubPhotoUploadRequest,
  ): Promise<PhotoUpload> {
    return this.photos.requestUpload(actorOf(req), slug, body);
  }

  @Post(':photoId/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publie la photo une fois envoyée et vérifiée' })
  @ApiOkResponse({ schema: openApi(publicPhotoSchema) })
  @ApiConflictResponse({ description: 'Fichier pas encore arrivé' })
  @ApiUnprocessableEntityResponse({ description: 'Fichier non conforme' })
  confirm(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('photoId') photoId: string,
  ): Promise<PublicPhoto> {
    return this.photos.confirm(actorOf(req), slug, photoId);
  }

  @Patch(':photoId')
  @OrganizerRole('ADMIN')
  @ApiOperation({ summary: 'Temps fort (mise en avant) ou légende' })
  @ApiBody({ schema: openApi(updatePhotoSchema) })
  @ApiOkResponse({ schema: openApi(publicPhotoSchema) })
  update(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('photoId') photoId: string,
    @Body({ schema: updatePhotoSchema }) body: UpdatePhoto,
  ): Promise<PublicPhoto> {
    return this.photos.update(actorOf(req), slug, photoId, body);
  }

  @Delete(':photoId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retire une photo (un bénévole : seulement les siennes)',
  })
  @ApiNoContentResponse({ description: 'Photo retirée' })
  remove(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('photoId') photoId: string,
  ): Promise<void> {
    return this.photos.remove(actorOf(req), slug, photoId);
  }
}

/** Galerie publique et temps forts d'un tournoi. */
@ApiTags('public')
@Controller('public/tournaments/:slug/photos')
export class PublicPhotosController {
  constructor(private readonly photos: PublicPhotosService) {}

  @Get()
  @ApiOperation({
    summary: 'Photos du tournoi ou d’un match, les plus récentes d’abord',
  })
  @ApiOkResponse({ schema: openApi(z.array(publicPhotoSchema)) })
  @ApiNotFoundResponse({ description: 'Tournoi introuvable' })
  list(
    @Param('slug') slug: string,
    @Query({ schema: publicPhotosQuerySchema }) query: PublicPhotosQuery,
  ): Promise<PublicPhoto[]> {
    return this.photos.list(slug, query);
  }
}
