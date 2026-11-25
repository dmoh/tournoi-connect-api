import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import { createHash } from 'node:crypto';
import { mergeRouteConfig } from './route-config.js';

/**
 * Cache court des lectures publiques sondées par les spectateurs (direct) :
 * le navigateur garde la réponse 2 s, la ressert jusqu'à 5 s de plus pendant
 * qu'il la revalide, et la revalidation (`If-None-Match`) répond 304 sans
 * corps tant que rien n'a changé. Le délai de 3 s de l'exigence « tableau à
 * jour » tient : sondage toutes les 5 s, cache de 2 s au plus.
 */
export const PUBLIC_CACHE_CONTROL =
  'public, max-age=2, stale-while-revalidate=5';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Route publique à cache court et ETag, posée par @PublicCache. */
    publicCache?: true;
  }
}

/** Marque une lecture publique : Cache-Control court, ETag, 304 sur If-None-Match. */
export const PublicCache = (): MethodDecorator =>
  mergeRouteConfig({ publicCache: true });

/**
 * Ajoute aux routes marquées @PublicCache un hook onSend qui pose les
 * en-têtes de cache et répond 304 à une revalidation. À appeler avant
 * app.init(), qui déclare les routes. Seules les réponses 200 sont mises en
 * cache : une erreur (problem+json) reste sans cache.
 */
export function registerPublicCache(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRoute', (route) => {
    if (route.config?.publicCache) {
      addOnSend(route, publicCacheHook);
    }
  });
}

type OnSend = (
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
) => Promise<unknown>;

const publicCacheHook: OnSend = async (request, reply, payload) => {
  if (
    reply.statusCode !== 200 ||
    !(typeof payload === 'string' || Buffer.isBuffer(payload))
  ) {
    return payload;
  }
  const etag = etagOf(payload);
  void reply.header('cache-control', PUBLIC_CACHE_CONTROL);
  void reply.header('etag', etag);
  if (etagMatches(request.headers['if-none-match'], etag)) {
    // Fastify retire corps, Content-Type et Content-Length d'une 304.
    void reply.code(304);
    return '';
  }
  return payload;
};

/** ETag fort : empreinte du corps sérialisé. */
export function etagOf(payload: string | Buffer): string {
  return `"${createHash('sha1').update(payload).digest('base64url')}"`;
}

/** `If-None-Match` : liste d'ETags (forts ou faibles) ou `*`. */
export function etagMatches(
  header: string | string[] | undefined,
  etag: string,
): boolean {
  if (header === undefined) {
    return false;
  }
  const weak = `W/${etag}`;
  return (Array.isArray(header) ? header : [header])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .some((value) => value === '*' || value === etag || value === weak);
}

function addOnSend(route: RouteOptions, handler: OnSend): void {
  const hooks = route as unknown as { onSend?: unknown };
  hooks.onSend =
    hooks.onSend === undefined ? [handler] : [hooks.onSend, handler].flat();
}
