import { z } from 'zod';

/**
 * Variables d'environnement validées au démarrage : l'application refuse de
 * démarrer si l'une d'elles manque ou est mal formée.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_APP_URL: z.url().default('http://localhost:4200'),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Configuration invalide :\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
