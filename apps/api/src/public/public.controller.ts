import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import {
  pageQuerySchema,
  type Page,
  type PageQuery,
} from '../common/pagination.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  audienceEventSchema,
  matchFeedSchema,
  newsSchema,
  pollResultSchema,
  publicSponsorsSchema,
  reactionCountsSchema,
  reactionSchema,
  voteSchema,
  type AudienceEvent,
  type MatchFeed,
  type NewsItem,
  type ReactionCounts,
  type ReactionInput,
  type PollResult,
  type PublicSponsors,
} from './public-l5.schemas.js';
import {
  dayMatchesSchema,
  dayQuerySchema,
  nearbyPageSchema,
  searchQuerySchema,
  tournamentDetailSchema,
  type DayMatches,
  type DayQuery,
  type NearbyTournament,
  type SearchQuery,
  type TournamentDetail,
} from './public.schemas.js';
import { PublicService } from './public.service.js';

/**
 * Lectures publiques (pages rendues côté serveur par la PWA) et mesure
 * d'audience. Aucune authentification ; seuls les tournois publiés sont lus.
 */
@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get('tournaments')
  @ApiOperation({
    summary:
      'Tournois en cours ou à venir autour d’un point, par distance, date puis id (paginé)',
  })
  @ApiQuery({ name: 'lat', type: Number })
  @ApiQuery({ name: 'lng', type: Number })
  @ApiQuery({ name: 'radiusKm', type: Number, required: false })
  @ApiQuery({
    name: 'sport',
    enum: ['football', 'handball', 'basketball', 'volleyball', 'rugby'],
    required: false,
  })
  @ApiOkResponse({ schema: openApi(nearbyPageSchema) })
  @ApiBadRequestResponse({
    description: 'Paramètre, limite ou curseur invalide',
  })
  search(
    @Query({ schema: searchQuerySchema }) query: SearchQuery,
  ): Promise<Page<NearbyTournament>> {
    return this.service.search(query);
  }

  @Get('tournaments/:slug')
  @ApiOperation({
    summary: 'Page publique d’un tournoi : équipes, matchs, classements',
  })
  @ApiOkResponse({ schema: openApi(tournamentDetailSchema) })
  @ApiNotFoundResponse({ description: 'Tournoi inconnu ou non publié' })
  detail(@Param('slug') slug: string): Promise<TournamentDetail> {
    return this.service.detail(slug);
  }

  @Get('tournaments/:slug/matches')
  @ApiOperation({
    summary:
      'Matchs d’une journée (heure de Paris), par créneau puis par phase, et journées du tournoi',
  })
  @ApiOkResponse({ schema: openApi(dayMatchesSchema) })
  @ApiBadRequestResponse({ description: 'Journée mal formée (AAAA-MM-JJ)' })
  @ApiNotFoundResponse({ description: 'Tournoi inconnu ou non publié' })
  matches(
    @Param('slug') slug: string,
    @Query({ schema: dayQuerySchema }) query: DayQuery,
  ): Promise<DayMatches> {
    return this.service.matchesByDay(slug, query.day);
  }

  @Get('tournaments/:slug/news')
  @ApiOperation({
    summary:
      'Fil News paginé, plus récent en tête ; une carte sponsorisée au plus pour quatre éléments',
  })
  @ApiOkResponse({ schema: openApi(newsSchema) })
  @ApiBadRequestResponse({ description: 'Limite ou curseur invalide' })
  @ApiNotFoundResponse({ description: 'Tournoi inconnu ou non publié' })
  news(
    @Param('slug') slug: string,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ): Promise<Page<NewsItem>> {
    return this.service.news(slug, query);
  }

  @Get('tournaments/:slug/sponsors')
  @ApiOperation({
    summary: 'Sponsors affichés : bannière Or, bandeau partagé, terrains',
  })
  @ApiOkResponse({ schema: openApi(publicSponsorsSchema) })
  sponsors(@Param('slug') slug: string): Promise<PublicSponsors> {
    return this.service.sponsors(slug);
  }

  @Get('tournaments/:slug/matches/:matchId/feed')
  @ApiOperation({
    summary: 'Fil du direct d’un match : événements, réactions, mise à jour',
  })
  @ApiOkResponse({ schema: openApi(matchFeedSchema) })
  @ApiNotFoundResponse({ description: 'Match ou tournoi inconnu' })
  matchFeed(
    @Param('slug') slug: string,
    @Param('matchId') matchId: string,
  ): Promise<MatchFeed> {
    return this.service.matchFeed(slug, matchId);
  }

  @Post('tournaments/:slug/matches/:matchId/reactions')
  @RateLimited('reaction')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Réaction anonyme d’un spectateur, une par appareil et par emoji',
  })
  @ApiBody({ schema: openApi(reactionSchema) })
  @ApiOkResponse({ schema: openApi(reactionCountsSchema) })
  @ApiNotFoundResponse({ description: 'Match ou tournoi inconnu' })
  react(
    @Param('slug') slug: string,
    @Param('matchId') matchId: string,
    @Body({ schema: reactionSchema }) body: ReactionInput,
  ): Promise<ReactionCounts> {
    return this.service.react(slug, matchId, body);
  }

  @Post('posts/:postId/votes')
  @RateLimited('vote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Vote anonyme à un sondage du fil News' })
  @ApiBody({ schema: openApi(voteSchema) })
  @ApiOkResponse({ schema: openApi(pollResultSchema) })
  vote(
    @Param('postId') postId: string,
    @Body({ schema: voteSchema }) body: { optionId: string },
  ): Promise<PollResult> {
    return this.service.vote(postId, body.optionId);
  }

  @Post('audience')
  @RateLimited('audience')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Impression ou clic d’un sponsor, cumulé par heure',
  })
  @ApiBody({ schema: openApi(audienceEventSchema) })
  @ApiNoContentResponse()
  audience(
    @Body({ schema: audienceEventSchema }) event: AudienceEvent,
  ): Promise<void> {
    return this.service.recordAudience(event);
  }
}
