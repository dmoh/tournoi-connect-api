import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthKeys } from '../auth/auth-keys.js';
import {
  AuthGuard,
  CurrentUser,
  authenticate,
  type AuthRequest,
  type AuthUser,
} from '../auth/auth.guard.js';
import { AUTH_KEYS } from '../auth/auth.tokens.js';
import { Clock } from '../common/clock.js';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  followsSchema,
  pushConfigSchema,
  subscribeSchema,
  unsubscribeSchema,
  type Follows,
  type PushConfig,
  type Subscribe,
  type Unsubscribe,
} from './push.schemas.js';
import { PushService } from './push.service.js';

/** Abonnement d'un navigateur aux notifications (connecté ou non). */
@ApiTags('push')
@Controller('push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly clock: Clock,
    @Inject(AUTH_KEYS) private readonly keys: AuthKeys | null,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Clé publique VAPID pour s’abonner (null sans notifications)',
  })
  @ApiOkResponse({ schema: openApi(pushConfigSchema) })
  config(): PushConfig {
    return this.push.config();
  }

  @Put('subscriptions')
  @RateLimited('pushSubscribe')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Abonner ce navigateur avec ses suivis et préférences ; relié au compte si le jeton est fourni',
  })
  @ApiBody({ schema: openApi(subscribeSchema) })
  @ApiNoContentResponse()
  @ApiServiceUnavailableResponse({
    description: 'Notifications non configurées',
  })
  async subscribe(
    @Req() request: AuthRequest,
    @Body({ schema: subscribeSchema }) body: Subscribe,
  ): Promise<void> {
    const user = request.headers.authorization
      ? await authenticate(request, this.keys, this.clock.now())
      : null;
    await this.push.subscribe(body, user?.id ?? null);
  }

  @Post('subscriptions/delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Désabonner ce navigateur' })
  @ApiBody({ schema: openApi(unsubscribeSchema) })
  @ApiNoContentResponse()
  unsubscribe(
    @Body({ schema: unsubscribeSchema }) body: Unsubscribe,
  ): Promise<void> {
    return this.push.unsubscribe(body.endpoint);
  }
}

/** Suivis du compte, partagés entre ses appareils. */
@ApiTags('push')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@UseGuards(AuthGuard)
@Controller('me/follows')
export class FollowsController {
  constructor(private readonly push: PushService) {}

  @Get()
  @ApiOperation({ summary: 'Tournois et équipes suivis par le compte' })
  @ApiOkResponse({ schema: openApi(followsSchema) })
  get(@CurrentUser() user: AuthUser): Promise<Follows> {
    return this.push.follows(user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Remplacer les suivis du compte' })
  @ApiBody({ schema: openApi(followsSchema) })
  @ApiOkResponse({ schema: openApi(followsSchema) })
  replace(
    @CurrentUser() user: AuthUser,
    @Body({ schema: followsSchema }) body: Follows,
  ): Promise<Follows> {
    return this.push.replaceFollows(user.id, body);
  }

  @Post('merge')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ajouter les suivis de l’appareil à ceux du compte (connexion)',
  })
  @ApiBody({ schema: openApi(followsSchema) })
  @ApiOkResponse({ schema: openApi(followsSchema) })
  merge(
    @CurrentUser() user: AuthUser,
    @Body({ schema: followsSchema }) body: Follows,
  ): Promise<Follows> {
    return this.push.mergeFollows(user.id, body);
  }
}
