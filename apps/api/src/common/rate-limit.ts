import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  RouteConfig,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteOptions,
} from 'fastify';
import { createHash } from 'node:crypto';
import { AuthKeys, normalizeEmail } from '../auth/auth-keys.js';
import { AUTH_KEYS } from '../auth/auth.tokens.js';
import { Clock } from './clock.js';

/**
 * Ce que compte une limite : l'IP du client (vue à travers Caddy, voir
 * TRUSTED_PROXIES), l'adresse email du corps, le compte connecté, ou le lien
 * du rapporteur.
 */
export type RateLimitKey = 'ip' | 'email' | 'user' | 'reporterToken';

export interface RateLimit {
  key: RateLimitKey;
  /** Requêtes admises par fenêtre. */
  max: number;
  /** Fenêtre fixe, en millisecondes. */
  windowMs: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * Limites de débit des routes exposées aux abus (envoi d'emails, écriture
 * anonyme, saisie du rapporteur). Valeurs de départ, à revoir après le premier
 * tournoi : les spectateurs d'un même stade partagent souvent une IP (Wi-Fi du
 * club, NAT des opérateurs mobiles), d'où des plafonds larges sur les routes
 * publiques. Les limites métier (5 codes par adresse et par heure, 30
 * invitations par club et par heure) restent en base, en plus de celles-ci.
 */
export const RATE_LIMITS = {
  /** Code de connexion : envois d'emails par IP, et boîte inondée depuis plusieurs IP. */
  authCode: [
    { key: 'ip', max: 10, windowMs: MINUTE },
    { key: 'email', max: 5, windowMs: 10 * MINUTE },
  ],
  /** Saisie du code (déjà limitée à 5 essais par code). */
  authVerify: [{ key: 'ip', max: 10, windowMs: MINUTE }],
  /** Rafraîchissement : chaque PWA ouverte le fait toutes les 15 minutes. */
  authRefresh: [{ key: 'ip', max: 30, windowMs: MINUTE }],
  /** Début et retour de la connexion Google, Apple, Facebook. */
  oauth: [{ key: 'ip', max: 20, windowMs: MINUTE }],
  /** Impressions et clics des sponsors : plusieurs par écran affiché. */
  audience: [{ key: 'ip', max: 300, windowMs: MINUTE }],
  /** Vote à un sondage du fil News. */
  vote: [{ key: 'ip', max: 60, windowMs: MINUTE }],
  /** Réactions du direct (emoji). */
  reaction: [{ key: 'ip', max: 120, windowMs: MINUTE }],
  /** Abonnement d'un navigateur aux notifications. */
  pushSubscribe: [{ key: 'ip', max: 30, windowMs: MINUTE }],
  /** Inscription d'une équipe (Idempotency-Key : les rejeux comptent aussi). */
  registration: [{ key: 'user', max: 10, windowMs: 10 * MINUTE }],
  /**
   * Saisie du rapporteur : un événement toutes les 2 secondes en moyenne,
   * avec une rafale de 15 pour la file hors ligne rejouée au retour du réseau.
   */
  reporterEvent: [{ key: 'reporterToken', max: 15, windowMs: 30 * SECOND }],
  /** Invitations d'un club, en plus de la limite métier par club. */
  invitation: [{ key: 'ip', max: 20, windowMs: MINUTE }],
} as const satisfies Record<string, readonly RateLimit[]>;

export type RateLimitPolicy = keyof typeof RATE_LIMITS;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Limites appliquées à la route (RATE_LIMITS), posées par @RateLimited. */
    rateLimitPolicy?: RateLimitPolicy;
  }
}

/** Applique à la route les limites nommées de RATE_LIMITS. */
export const RateLimited = (policy: RateLimitPolicy): MethodDecorator =>
  RouteConfig({ rateLimitPolicy: policy });

export interface RateLimitSettings {
  /**
   * Multiplie toutes les limites : 1 en production. Les tests e2e le relèvent,
   * sauf ceux qui vérifient les limites.
   */
  factor?: number;
}

type LimitHook = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

/** Clé d'une requête sans objet à compter (ex. pas de jeton) : non limitée. */
const NO_KEY = '-';

/**
 * Enregistre @fastify/rate-limit (sans limite globale) et ajoute aux routes
 * marquées @RateLimited un contrôle par limite. À appeler avant app.init(),
 * qui déclare les routes.
 */
export async function registerRateLimits(
  app: NestFastifyApplication,
  settings: RateLimitSettings = {},
): Promise<void> {
  const factor = settings.factor ?? 1;
  // Compteurs en mémoire : un seul serveur d'API. Avec plusieurs instances,
  // passer ici `redis` (client ioredis sur REDIS_URL) et `nameSpace` : les
  // clés sont déjà préfixées par route et par limite.
  await app.register(rateLimit, { global: false });
  const fastify = app.getHttpAdapter().getInstance();
  const keyOf = keyReader(
    app.get<symbol, AuthKeys | null>(AUTH_KEYS, { strict: false }),
    app.get(Clock, { strict: false }),
  );
  fastify.addHook('onRoute', (route) => {
    const policy = route.config?.rateLimitPolicy;
    if (!policy) {
      return;
    }
    for (const limit of RATE_LIMITS[policy]) {
      const name = `${String(route.method)} ${route.url} ${limit.key}`;
      // Le corps n'est lu qu'après onRequest : la limite par email attend preHandler.
      addHook(
        route,
        limit.key === 'email' ? 'preHandler' : 'onRequest',
        limiter(fastify, name, limit, factor, keyOf),
      );
    }
  });
}

function limiter(
  fastify: FastifyInstance,
  name: string,
  limit: RateLimit,
  factor: number,
  keyOf: (key: RateLimitKey, request: FastifyRequest) => Promise<string | null>,
): LimitHook {
  const check = fastify.createRateLimit({
    max: Math.max(1, Math.round(limit.max * factor)),
    timeWindow: limit.windowMs,
    keyGenerator: async (request) => {
      const key = await keyOf(limit.key, request);
      return key === null ? NO_KEY : `${name}:${key}`;
    },
    allowList: [NO_KEY],
  });
  return async (request, reply) => {
    const result = await check(request);
    if (result.isAllowed || !result.isExceeded) {
      return;
    }
    // Levée dans un hook Fastify, l'exception passe quand même par
    // ProblemDetailsFilter : problem+json comme les erreurs des contrôleurs.
    void reply.header('retry-after', String(result.ttlInSeconds));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: `Trop de requêtes. Réessayez dans ${result.ttlInSeconds} s.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  };
}

function keyReader(
  keys: AuthKeys | null,
  clock: Clock,
): (key: RateLimitKey, request: FastifyRequest) => Promise<string | null> {
  return async (key, request) => {
    switch (key) {
      case 'ip':
        return normalizeIP(request.ip);
      case 'email': {
        const email = (request.body as { email?: unknown } | undefined)?.email;
        return typeof email === 'string' && email
          ? digest(normalizeEmail(email))
          : null;
      }
      case 'reporterToken': {
        const token = (request.params as { token?: unknown }).token;
        return typeof token === 'string' && token ? digest(token) : null;
      }
      case 'user': {
        // Jeton vérifié : un `sub` forgé ne doit pas vider le quota d'un autre
        // compte. Sans jeton valide, AuthGuard répond 401 ensuite.
        const header = request.headers.authorization ?? '';
        const token = header.startsWith('Bearer ')
          ? header.slice('Bearer '.length)
          : '';
        const claims =
          keys && token ? await keys.verifyAccess(token, clock.now()) : null;
        return claims?.sub ?? null;
      }
    }
  };
}

/** Email et lien du rapporteur ne sont gardés qu'en empreinte. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function addHook(
  route: RouteOptions,
  hook: 'onRequest' | 'preHandler',
  handler: LimitHook,
): void {
  const hooks = route as unknown as Record<string, unknown>;
  const existing = hooks[hook];
  hooks[hook] = existing === undefined ? [handler] : [existing, handler].flat();
}
