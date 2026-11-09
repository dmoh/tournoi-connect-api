// Régénère les types depuis apps/api/openapi.json (commande : pnpm openapi).
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, '..', '..', 'apps', 'api', 'openapi.json');

const schema = JSON.parse(await readFile(source, 'utf8'));
const ast = await openapiTS(schema);
const header =
  '// Fichier généré par `pnpm openapi` — ne pas modifier à la main.\n\n';

await writeFile(resolve(root, 'src', 'openapi.ts'), header + astToString(ast));
await copyFile(source, resolve(root, 'openapi.json'));
console.log('Contrats régénérés depuis', source);
