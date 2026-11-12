import helmet from '@fastify/helmet';
import { StandardSchemaValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import {
  registerRateLimits,
  type RateLimitSettings,
} from './common/rate-limit.js';

/**
 * Proxys dont on lit X-Forwarded-For : Caddy, sur le réseau Docker (adresses
 * privées) ou en local. Caddy remplace l'en-tête reçu d'Internet par l'IP du
 * client ; une requête venue d'ailleurs garde son IP de connexion, quel que
 * soit l'en-tête qu'elle envoie.
 */
export const TRUSTED_PROXIES = ['loopback', 'uniquelocal'];

/** Options Fastify partagées par createApp et les tests e2e. */
export const FASTIFY_OPTIONS = {
  bodyLimit: 1_048_576,
  trustProxy: TRUSTED_PROXIES,
};

export interface AppSettings {
  rateLimit?: RateLimitSettings;
}

/** Configuration HTTP partagée par main.ts, les tests e2e et l'export OpenAPI. */
export async function configureApp(
  app: NestFastifyApplication,
  settings: AppSettings = {},
): Promise<NestFastifyApplication> {
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  // Validation par les schémas zod des routes (Standard Schema, NestJS 12).
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.register(helmet);
  await registerRateLimits(app, settings.rateLimit);
  return app;
}

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(FASTIFY_OPTIONS),
    // Corps brut gardé : la signature des webhooks Stripe porte sur lui.
    { rawBody: true },
  );
  return configureApp(app);
}

export function buildOpenApiDocument(
  app: NestFastifyApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Tournoi Connect API')
    .setDescription('API de la plateforme Tournoi Connect')
    .setVersion('1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
