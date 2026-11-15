import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { Clock } from '../../common/clock.js';
import { RateLimited } from '../../common/rate-limit.js';
import type { Env } from '../../config/env.js';
import { AuthKeys, SESSION_TTL_MS } from '../auth-keys.js';
import { AuthService } from '../auth.service.js';
import { AUTH_KEYS } from '../auth.tokens.js';
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  readCookie,
  serializeCookie,
} from '../cookies.js';
import {
  OAUTH_PROVIDERS,
  OAuthProviders,
  randomToken,
  type OAuthFlow,
  type OAuthProvider,
} from './oauth-providers.js';

const FLOW_TTL_SECONDS = 10 * 60;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Écran de la PWA où revenir : un chemin interne, jamais une autre origine. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    /^\/(?![/\\])[^\s]*$/.test(value) &&
    value.length <= 300
    ? value
    : '/';
}

/**
 * Connexion en un clic (Google, Apple, Facebook) : redirections navigateur,
 * hors du contrat OpenAPI. Au retour, la session est posée en cookie et la
 * PWA reprend l'écran demandé ; en cas d'échec, l'écran de connexion
 * l'explique.
 */
@ApiExcludeController()
@Controller('auth/oauth')
export class OAuthController {
  private readonly logger = new Logger('OAuth');

  constructor(
    private readonly providers: OAuthProviders,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly clock: Clock,
    @Inject(AUTH_KEYS) private readonly keys: AuthKeys | null,
  ) {}

  @Get(':provider/start')
  @RateLimited('oauth')
  async start(
    @Param('provider') raw: string,
    @Query('returnTo') returnTo: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const provider = this.parse(raw);
    if (!provider || !this.keys) {
      return this.fail(reply, raw);
    }
    const flow: OAuthFlow = {
      provider,
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken() + randomToken(),
      returnTo: safeReturnTo(returnTo),
    };
    const signed = await new SignJWT({ ...flow })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${FLOW_TTL_SECONDS}s`)
      .sign(this.keys.oauth);
    reply
      .header(
        'set-cookie',
        serializeCookie(OAUTH_COOKIE, signed, {
          maxAgeSeconds: FLOW_TTL_SECONDS,
          path: OAUTH_COOKIE_PATH,
          secure: true,
          // Apple revient en POST depuis son domaine : seul None laisse passer le cookie.
          sameSite: 'None',
        }),
      )
      .redirect(this.providers.authorizeUrl(flow), 302);
  }

  @Get(':provider/callback')
  @RateLimited('oauth')
  callbackGet(
    @Param('provider') raw: string,
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.finish(raw, query, request, reply);
  }

  @Post(':provider/callback')
  @RateLimited('oauth')
  @HttpCode(302)
  callbackPost(
    @Param('provider') raw: string,
    @Body() body: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.finish(raw, body ?? {}, request, reply);
  }

  private async finish(
    raw: string,
    params: Record<string, unknown>,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const provider = this.parse(raw);
    const flow = provider ? await this.readFlow(request) : null;
    const code = typeof params['code'] === 'string' ? params['code'] : '';
    if (
      !provider ||
      !flow ||
      flow.provider !== provider ||
      params['state'] !== flow.state ||
      !code
    ) {
      return this.fail(reply, raw);
    }
    try {
      const identity = await this.providers.identify(flow, {
        code,
        ...(typeof params['user'] === 'string' ? { user: params['user'] } : {}),
      });
      const session = await this.auth.signInWith(
        identity,
        request.headers['user-agent'],
      );
      reply
        .header('set-cookie', [
          serializeCookie(REFRESH_COOKIE, session.refreshToken, {
            maxAgeSeconds: SESSION_TTL_MS / 1000,
            path: REFRESH_COOKIE_PATH,
            secure:
              this.config.get('NODE_ENV', { infer: true }) === 'production',
            sameSite: 'Strict',
          }),
          this.clearFlow(),
        ])
        .redirect(this.appUrl(flow.returnTo), 302);
    } catch (error) {
      this.logger.warn(
        `Connexion ${provider} refusée : ${(error as Error).message}`,
      );
      this.fail(reply, raw);
    }
  }

  private async readFlow(request: FastifyRequest): Promise<OAuthFlow | null> {
    const token = readCookie(request.headers.cookie, OAUTH_COOKIE);
    if (!token || !this.keys) {
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, this.keys.oauth, {
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      const provider = this.parse(text(payload['provider']).toLowerCase());
      return provider
        ? {
            provider,
            state: text(payload['state']),
            nonce: text(payload['nonce']),
            verifier: text(payload['verifier']),
            returnTo: safeReturnTo(payload['returnTo']),
          }
        : null;
    } catch {
      return null;
    }
  }

  private parse(raw: string): OAuthProvider | null {
    const provider = raw.toUpperCase() as OAuthProvider;
    return OAUTH_PROVIDERS.includes(provider) &&
      this.providers.enabled().includes(provider)
      ? provider
      : null;
  }

  /** Retour à l'écran de connexion, qui affiche l'échec. */
  private fail(reply: FastifyReply, raw: string): void {
    const provider = encodeURIComponent(raw.toLowerCase().slice(0, 20));
    reply
      .header('set-cookie', this.clearFlow())
      .redirect(this.appUrl(`/login?error=${provider}`), 302);
  }

  private clearFlow(): string {
    return serializeCookie(OAUTH_COOKIE, '', {
      maxAgeSeconds: 0,
      path: OAUTH_COOKIE_PATH,
      secure: true,
      sameSite: 'None',
    });
  }

  private appUrl(path: string): string {
    return `${this.config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }
}
