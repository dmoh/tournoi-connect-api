import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import { palmaresSchema, type Palmares } from './palmares.schemas.js';
import { PalmaresService } from './palmares.service.js';

@ApiTags('public')
@Controller('public/tournaments/:slug/palmares')
export class PalmaresController {
  constructor(private readonly palmares: PalmaresService) {}

  @Get()
  @ApiOperation({
    summary: 'Palmarès : podium une fois le tournoi joué, meilleurs buteurs',
  })
  @ApiOkResponse({ schema: openApi(palmaresSchema) })
  @ApiNotFoundResponse({ description: 'Tournoi introuvable ou masqué' })
  view(@Param('slug') slug: string): Promise<Palmares> {
    return this.palmares.view(slug);
  }
}
