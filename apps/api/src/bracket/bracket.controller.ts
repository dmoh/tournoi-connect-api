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
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerGuard,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  drawRequestSchema,
  drawSchema,
  winnerSchema,
  type DrawRequest,
  type DrawView,
  type WinnerInput,
} from './bracket.schemas.js';
import { BracketService } from './bracket.service.js';

/** Tirage, calendrier et tableau final d'un tournoi du club (admins). */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@ApiNotFoundResponse({ description: 'Tournoi ou match hors du club' })
@ApiHeader({
  name: 'X-Organization',
  required: false,
  description: 'Club concerné (slug), si le compte en a plusieurs',
})
@UseGuards(OrganizerGuard)
@Controller('organizer/tournaments/:slug')
export class BracketController {
  constructor(private readonly bracket: BracketService) {}

  @Get('draw')
  @ApiOperation({ summary: 'Équipes inscrites, poules tirées et calendrier' })
  @ApiOkResponse({ schema: openApi(drawSchema) })
  view(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<DrawView> {
    return this.bracket.view(req.organizationSlug!, slug);
  }

  @Post('draw')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Tire les poules et génère le calendrier (refait le tirage tant qu’aucun match n’a commencé)',
  })
  @ApiBody({ schema: openApi(drawRequestSchema) })
  @ApiOkResponse({ schema: openApi(drawSchema) })
  @ApiConflictResponse({
    description: 'Match commencé, ou moins de deux équipes',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Format sans tirage automatique',
  })
  draw(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Body({ schema: drawRequestSchema }) body: DrawRequest,
  ): Promise<DrawView> {
    return this.bracket.draw(req.organizationSlug!, slug, body.seed);
  }

  @Put('matches/:code/winner')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Vainqueur d’un match à élimination terminé sur un nul',
  })
  @ApiBody({ schema: openApi(winnerSchema) })
  @ApiNoContentResponse({
    description: 'Vainqueur enregistré, tableau mis à jour',
  })
  @ApiConflictResponse({ description: 'Le match n’attend pas de vainqueur' })
  winner(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('code') code: string,
    @Body({ schema: winnerSchema }) body: WinnerInput,
  ): Promise<void> {
    return this.bracket.setWinner(req.organizationSlug!, slug, code, body);
  }
}
