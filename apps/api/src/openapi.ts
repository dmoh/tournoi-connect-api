import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildOpenApiDocument, createApp } from './app.factory.js';

/** Écrit apps/api/openapi.json, source du paquet de contrats. */
const app = await createApp();
await app.init();
const target = resolve(import.meta.dirname, '..', 'openapi.json');
await writeFile(
  target,
  `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`,
);
await app.close();
console.log(`OpenAPI écrit dans ${target}`);
