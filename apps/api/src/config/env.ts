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
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),
  /**
   * Accès organisateur provisoire, en attendant l'authentification JWT (P1) :
   * jeton à présenter en Bearer et organisation qu'il ouvre. Sans jeton, les
   * routes organisateur répondent 401.
   */
  ORGANIZER_DEMO_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(24).optional(),
  ),
  ORGANIZER_DEMO_ORG: z.string().min(1).default('etoile-de-l-arve'),
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
