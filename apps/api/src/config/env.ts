import { z } from 'zod';

const empty = (value: unknown) => (value === '' ? undefined : value);
const optional = () => z.preprocess(empty, z.string().min(1).optional());
const optionalSecret = (min: number) =>
  z.preprocess(empty, z.string().min(min).optional());

/** Origine de la PWA de production : aucun compte de test n'y est permis. */
export const PRODUCTION_APP_ORIGIN = 'https://app.tournoi-connect.com';

// URL.parse : null si PUBLIC_APP_URL est mal formée (erreur déjà signalée).
const isProductionApp = (url: string) =>
  URL.parse(url)?.origin === PRODUCTION_APP_ORIGIN;

/** PWA servie en https hors du poste local (préprod, prod). */
const isPublicHttps = (url: string) => {
  const parsed = URL.parse(url);
  return (
    parsed?.protocol === 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) &&
    !parsed.hostname.endsWith('.localhost')
  );
};

const envVariables = z.object({
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
   * Ignoré sans ALLOW_TEST_ACCOUNTS=true ; refusé au démarrage en production.
   */
  TEST_ACCOUNTS_CODE: z.preprocess(
    empty,
    z
      .string()
      .regex(/^\d{6}$/, 'TEST_ACCOUNTS_CODE compte 6 chiffres.')
      .optional(),
  ),
  /** Active le code fixe des comptes de test (préprod) : « true » seulement. */
  ALLOW_TEST_ACCOUNTS: z.preprocess(
    empty,
    z.enum(['true', 'false']).optional(),
  ),
  /**
   * Paiements des inscriptions (Stripe Connect). Sans clé, une inscription
   * payante est refusée (503) ; les tournois gratuits restent ouverts.
   */
  STRIPE_SECRET_KEY: optionalSecret(20),
  /** Secret de signature du webhook Stripe (whsec_…). */
  STRIPE_WEBHOOK_SECRET: optionalSecret(20),
  /**
   * Notifications web push (VAPID, base64url) : clé publique (65 octets) et
   * privée (32 octets). Sans elles, l'abonnement aux notifications est fermé.
   */
  VAPID_PUBLIC_KEY: optional(),
  VAPID_PRIVATE_KEY: optionalSecret(40),
  /**
   * Envoi des emails : SES en préprod et en prod, journal sur le poste local
   * (refusé quand la PWA est en https hors localhost : codes et liens
   * finiraient dans les journaux).
   */
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

/**
 * Variables d'environnement validées au démarrage : l'application refuse de
 * démarrer si l'une d'elles manque ou est mal formée, ou si la combinaison est
 * dangereuse (comptes de test en production, emails au journal en ligne).
 */
export const envSchema = envVariables
  .superRefine((env, ctx) => {
    if (
      isProductionApp(env.PUBLIC_APP_URL) &&
      (env.TEST_ACCOUNTS_CODE !== undefined ||
        env.ALLOW_TEST_ACCOUNTS !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['TEST_ACCOUNTS_CODE'],
        message:
          'TEST_ACCOUNTS_CODE et ALLOW_TEST_ACCOUNTS sont interdits en production.',
      });
    }
    if (env.ALLOW_TEST_ACCOUNTS === 'true' && !env.TEST_ACCOUNTS_CODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_TEST_ACCOUNTS'],
        message: 'ALLOW_TEST_ACCOUNTS=true exige TEST_ACCOUNTS_CODE.',
      });
    }
    if (env.MAIL_TRANSPORT === 'log' && isPublicHttps(env.PUBLIC_APP_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_TRANSPORT'],
        message:
          'MAIL_TRANSPORT=log est réservé au poste local : choisir ses (PWA en https).',
      });
    }
  })
  // Sans le drapeau explicite, le code fixe ne sert à rien.
  .transform((env) => ({
    ...env,
    TEST_ACCOUNTS_CODE:
      env.ALLOW_TEST_ACCOUNTS === 'true' ? env.TEST_ACCOUNTS_CODE : undefined,
  }));

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
