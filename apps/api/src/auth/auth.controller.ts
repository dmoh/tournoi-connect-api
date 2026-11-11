import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { openApi } from '../common/openapi-schema.js';
import { RateLimited } from '../common/rate-limit.js';
import type { Env } from '../config/env.js';
import { SESSION_TTL_MS } from './auth-keys.js';
import { AuthGuard, CurrentUser, type AuthUser } from './auth.guard.js';
import {
  meSchema,
  profileSchema,
  providersSchema,
  requestCodeSchema,
  sessionSchema,
  verifyCodeSchema,
  type Me,
  type Profile,
  type RequestCode,
  type SessionResponse,
  type VerifyCode,
} from './auth.schemas.js';
import { AuthService, type OpenedSession } from './auth.service.js';
import { OAuthProviders } from './oauth/oauth-providers.js';
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  readCookie,
  serializeCookie,
} from './cookies.js';

/**
 * Connexion sans mot de passe : code à 6 chiffres par email, ou Google,
 * Apple, Facebook (routes /auth/oauth). Le jeton de rafraîchissement vit dans
 * un cookie HttpOnly limité à /api/v1/auth ; le jeton d'accès (15 min) est
 * renvoyé dans la réponse et gardé en mémoire par la PWA.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    @Inject(OAuthProviders) private readonly oauth: OAuthProviders,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'Fournisseurs de connexion en un clic configurés' })
  @ApiOkResponse({ schema: openApi(providersSchema) })
  providers(): { providers: ('GOOGLE' | 'APPLE' | 'FACEBOOK')[] } {
    return { providers: this.oauth.enabled() };
  }

  @Post('code')
  @RateLimited('authCode')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Envoyer un code de connexion à 6 chiffres par email',
  })
  @ApiBody({ schema: openApi(requestCodeSchema) })
  @ApiNoContentResponse({
    description: 'Code envoyé (même pour une adresse inconnue)',
  })
  @ApiTooManyRequestsResponse({ description: 'Plus de 5 codes en une heure' })
  async requestCode(
    @Body({ schema: requestCodeSchema }) body: RequestCode,
  ): Promise<void> {
    await this.auth.requestCode(body.email);
  }

  @Post('verify')
  @RateLimited('authVerify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ouvrir une session avec le code reçu (crée le compte au besoin)',
  })
  @ApiBody({ schema: openApi(verifyCodeSchema) })
  @ApiOkResponse({ schema: openApi(sessionSchema) })
  async verify(
    @Body({ schema: verifyCodeSchema }) body: VerifyCode,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    return this.withCookie(
      reply,
      await this.auth.verifyCode(
        body.email,
        body.code,
        request.headers['user-agent'],
      ),
    );
  }

  @Post('refresh')
  @RateLimited('authRefresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Nouveau jeton d’accès depuis le cookie de session',
  })
  @ApiOkResponse({ schema: openApi(sessionSchema) })
  @ApiUnauthorizedResponse({ description: 'Pas de session ou session expirée' })
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const token = readCookie(request.headers.cookie, REFRESH_COOKIE);
    return this.withCookie(
      reply,
      await this.auth.refresh(token, request.headers['user-agent']),
    );
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Fermer la session de cet appareil' })
  @ApiNoContentResponse()
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(readCookie(request.headers.cookie, REFRESH_COOKIE));
    reply.header('set-cookie', this.refreshCookie('', 0));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mon compte : profil, moyens de connexion, clubs et sponsors',
  })
  @ApiOkResponse({ schema: openApi(meSchema) })
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.auth.me(user.id);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Compléter son prénom et son nom' })
  @ApiBody({ schema: openApi(profileSchema) })
  @ApiOkResponse({ schema: openApi(meSchema) })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body({ schema: profileSchema }) body: Profile,
  ): Promise<Me> {
    return this.auth.updateProfile(user.id, body);
  }

  private withCookie(
    reply: FastifyReply,
    session: OpenedSession,
  ): SessionResponse {
    reply.header(
      'set-cookie',
      this.refreshCookie(session.refreshToken, SESSION_TTL_MS / 1000),
    );
    reply.header('cache-control', 'no-store');
    return session.response;
  }

  private refreshCookie(value: string, maxAgeSeconds: number): string {
    return serializeCookie(REFRESH_COOKIE, value, {
      maxAgeSeconds,
      path: REFRESH_COOKIE_PATH,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'Strict',
    });
  }
}
