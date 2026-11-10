import helmet from '@fastify/helmet';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

/** Configuration HTTP partagée par main.ts, les tests e2e et l'export OpenAPI. */
export async function configureApp(
  app: NestFastifyApplication,
): Promise<NestFastifyApplication> {
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  await app.register(helmet);
  return app;
}

export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576 }),
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
