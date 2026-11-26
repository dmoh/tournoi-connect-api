import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  nearestQuerySchema,
  placeListSchema,
  placeSchema,
  placeSearchQuerySchema,
  type NearestQuery,
  type Place,
  type PlaceList,
  type PlaceSearchQuery,
} from './places.schemas.js';
import { PlacesService } from './places.service.js';

@ApiTags('public')
@ApiServiceUnavailableResponse({ description: 'Géocodeur indisponible' })
@Controller('public/places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  @RateLimited('places')
  @ApiOperation({
    summary: 'Communes de France dont le nom commence ou ressemble à q',
  })
  @ApiOkResponse({ schema: openApi(placeListSchema) })
  async search(
    @Query({ schema: placeSearchQuerySchema }) query: PlaceSearchQuery,
  ): Promise<PlaceList> {
    return { items: await this.places.search(query.q, query.limit) };
  }

  @Get('nearest')
  @RateLimited('places')
  @ApiOperation({
    summary:
      'Commune la plus proche d’une position (arrondie au kilomètre, jamais gardée)',
  })
  @ApiOkResponse({ schema: openApi(placeSchema) })
  @ApiNotFoundResponse({ description: 'Aucune commune française à proximité' })
  nearest(
    @Query({ schema: nearestQuerySchema }) query: NearestQuery,
  ): Promise<Place> {
    return this.places.nearest(query.lat, query.lng);
  }

  @Get(':slug')
  @RateLimited('places')
  @ApiOperation({
    summary: 'Une commune par son identifiant d’URL (« megeve-74173 »)',
  })
  @ApiOkResponse({ schema: openApi(placeSchema) })
  @ApiNotFoundResponse({ description: 'Commune inconnue' })
  bySlug(@Param('slug') slug: string): Promise<Place> {
    return this.places.bySlug(slug);
  }
}
