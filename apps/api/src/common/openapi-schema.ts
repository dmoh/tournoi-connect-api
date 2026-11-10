import type { ApiBodyOptions } from '@nestjs/swagger';
import { z } from 'zod';

/** Type des schémas acceptés par les décorateurs OpenAPI de @nestjs/swagger. */
export type OpenApiSchema = NonNullable<
  Extract<ApiBodyOptions, { schema?: unknown }>['schema']
>;

/**
 * Schéma OpenAPI d'un schéma zod : la même définition valide les requêtes,
 * documente l'API et produit les types du paquet de contrats.
 */
export function openApi(schema: z.ZodType): OpenApiSchema {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    unrepresentable: 'any',
  }) as OpenApiSchema;
}
