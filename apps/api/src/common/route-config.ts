import { SetMetadata } from '@nestjs/common';
import { FASTIFY_ROUTE_CONFIG_METADATA } from '@nestjs/platform-fastify/constants.js';
import type { FastifyContextConfig } from 'fastify';

/**
 * Comme `RouteConfig` de @nestjs/platform-fastify, mais en fusionnant avec la
 * configuration déjà posée sur la route : `@RateLimited` et `@PublicCache`
 * se cumulent sur la même méthode au lieu de s'écraser.
 */
export function mergeRouteConfig(
  config: FastifyContextConfig,
): MethodDecorator {
  return (target, key, descriptor) => {
    const existing =
      (Reflect.getMetadata(
        FASTIFY_ROUTE_CONFIG_METADATA,
        descriptor.value as object,
      ) as FastifyContextConfig | undefined) ?? {};
    return SetMetadata(FASTIFY_ROUTE_CONFIG_METADATA, {
      ...existing,
      ...config,
    })(target, key, descriptor);
  };
}
