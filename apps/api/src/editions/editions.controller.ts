import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import { editionOptOutSchema, type EditionOptOut } from './editions.schemas.js';
import { EditionsService } from './editions.service.js';

/**
 * Lien « Ne plus recevoir les nouvelles éditions de ce club » d'une
 * invitation, sans connexion ; le POST sert aussi la désinscription en un
 * clic des clients mail (List-Unsubscribe-Post, RFC 8058).
 */
@ApiTags('public')
@Controller('public/edition-invites')
export class PublicEditionInvitesController {
  constructor(private readonly editions: EditionsService) {}

  @Get(':token')
  @RateLimited('editionOptOut')
  @ApiOperation({ summary: 'Club et état d’un lien de désinscription' })
  @ApiOkResponse({ schema: openApi(editionOptOutSchema) })
  @ApiNotFoundResponse({ description: 'Lien inconnu' })
  info(@Param('token') token: string): Promise<EditionOptOut> {
    return this.editions.optOutInfo(token);
  }

  @Post(':token/opt-out')
  @RateLimited('editionOptOut')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Ne plus recevoir les invitations aux nouvelles éditions du club (rejouable)',
  })
  @ApiOkResponse({ schema: openApi(editionOptOutSchema) })
  @ApiNotFoundResponse({ description: 'Lien inconnu' })
  optOut(@Param('token') token: string): Promise<EditionOptOut> {
    return this.editions.optOut(token);
  }
}
