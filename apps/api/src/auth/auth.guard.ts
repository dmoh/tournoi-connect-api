import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Clock } from '../common/clock.js';
import { AuthKeys } from './auth-keys.js';
import { AUTH_KEYS } from './auth.tokens.js';

export interface AuthUser {
  id: string;
  sessionId: string;
}

export interface AuthRequest extends FastifyRequest {
  user?: AuthUser;
}

/** Lit et vérifie le jeton d'accès (Authorization: Bearer …). */
export async function authenticate(
  request: AuthRequest,
  keys: AuthKeys | null,
  now: Date,
): Promise<AuthUser> {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : '';
  const claims = keys && token ? await keys.verifyAccess(token, now) : null;
  if (!claims) {
    throw new UnauthorizedException('Authentification requise.');
  }
  request.user = { id: claims.sub, sessionId: claims.sid };
  return request.user;
}

/** Route réservée à une personne connectée. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_KEYS) private readonly keys: AuthKeys | null,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await authenticate(
      context.switchToHttp().getRequest<AuthRequest>(),
      this.keys,
      this.clock.now(),
    );
    return true;
  }
}

/** Compte connecté (posé par AuthGuard ou OrganizerGuard). */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (!user) {
      throw new UnauthorizedException('Authentification requise.');
    }
    return user;
  },
);
