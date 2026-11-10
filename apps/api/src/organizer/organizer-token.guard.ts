import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env.js';

/** Organisation ouverte par le jeton, posée sur la requête par la garde. */
export interface OrganizerRequest extends FastifyRequest {
  organizationSlug?: string;
}

/**
 * Accès organisateur provisoire, en attendant l'authentification JWT et la
 * matrice de capacités (P1) : un jeton de configuration en Bearer ouvre une
 * seule organisation. Sans ORGANIZER_DEMO_TOKEN, toutes les routes
 * organisateur répondent 401.
 */
@Injectable()
export class OrganizerTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('ORGANIZER_DEMO_TOKEN', { infer: true });
    const request = context.switchToHttp().getRequest<OrganizerRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : '';
    if (!expected || !sameSecret(token, expected)) {
      throw new UnauthorizedException('Authentification requise.');
    }
    request.organizationSlug = this.config.get('ORGANIZER_DEMO_ORG', {
      infer: true,
    });
    return true;
  }
}

/** Comparaison à temps constant, pour ne rien révéler du jeton attendu. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
