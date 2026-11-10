import { z } from 'zod';

const empty = (value: unknown) => (value === '' ? undefined : value);
const optional = () => z.preprocess(empty, z.string().min(1).optional());
const optionalSecret = (min: number) =>
  z.preprocess(empty, z.string().min(min).optional());

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
   * Secret des comptes (64 caractères aléatoires) : signature des jetons
   * d'accès, empreinte des codes de connexion, liens du rapporteur. Sans lui,
   * la connexion est fermée (routes /auth et organisateur en 401).
   */
  AUTH_SECRET: optionalSecret(32),
  /**
   * Préprod uniquement : code fixe à 6 chiffres des comptes de test
   * (adresses @example.org de seedDemo, qui ne reçoivent pas d'email).
   * Jamais en production.
   */
  TEST_ACCOUNTS_CODE: z.preprocess(
    empty,
    z
      .string()
      .regex(/^\d{6}$/, 'TEST_ACCOUNTS_CODE compte 6 chiffres.')
      .optional(),
  ),
  /** Envoi des emails : SES en préprod et en prod, journal sinon. */
  MAIL_TRANSPORT: z.enum(['ses', 'log']).default('log'),
  MAIL_FROM: z
    .string()
    .min(3)
    .default('Tournoi Connect <noreply@tournoi-connect.com>'),
  AWS_REGION: z.string().min(1).default('eu-west-3'),
  /** Connexion en un clic : chaque fournisseur ne s'affiche que s'il est configuré. */
  GOOGLE_CLIENT_ID: optional(),
  GOOGLE_CLIENT_SECRET: optional(),
  /** Apple : Services ID, équipe, clé « Sign in with Apple » (PEM, \n échappés). */
  APPLE_CLIENT_ID: optional(),
  APPLE_TEAM_ID: optional(),
  APPLE_KEY_ID: optional(),
  APPLE_PRIVATE_KEY: optional(),
  FACEBOOK_APP_ID: optional(),
  FACEBOOK_APP_SECRET: optional(),
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
