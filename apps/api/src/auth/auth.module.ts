import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { AuthKeys } from './auth-keys.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AUTH_KEYS } from './auth.tokens.js';
import { OAuthController } from './oauth/oauth.controller.js';
import { OAuthProviders } from './oauth/oauth-providers.js';

@Global()
@Module({
  controllers: [AuthController, OAuthController],
  providers: [
    {
      provide: AUTH_KEYS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const secret = config.get('AUTH_SECRET', { infer: true });
        return secret ? new AuthKeys(secret) : null;
      },
    },
    AuthService,
    AuthGuard,
    OAuthProviders,
  ],
  exports: [AUTH_KEYS, AuthService, AuthGuard, OAuthProviders],
})
export class AuthModule {}
