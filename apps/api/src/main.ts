import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApiDocument, createApp } from './app.factory.js';
import type { Env } from './config/env.js';

const app = await createApp();
const config = app.get<ConfigService<Env, true>>(ConfigService);

if (config.get('NODE_ENV', { infer: true }) !== 'production') {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
}

// 0.0.0.0 : indispensable pour être joignable dans un conteneur.
await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
