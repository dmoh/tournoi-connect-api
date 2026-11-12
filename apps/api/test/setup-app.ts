import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { FASTIFY_OPTIONS, configureApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { Clock } from '../src/common/clock.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { MailSender, type MailMessage } from '../src/mail/mail-sender.js';
import { seedDemo } from '../src/database/seed.js';

/**
 * Secret des comptes des tests, tiré à chaque lancement : aucun secret, même
 * factice, n'est écrit dans le dépôt (détection de secrets).
 */
const AUTH_SECRET = randomBytes(32).toString('base64url');

/** Emails « envoyés » pendant les tests (codes de connexion). */
export const mailbox: MailMessage[] = [];

/** Propriétaire du club de démonstration (Étoile de l'Arve). */
export const ORGANIZER_EMAIL = 'orga@example.org';

/** Se connecte par code email et renvoie le jeton d'accès. */
export async function login(
  app: NestFastifyApplication,
  email = ORGANIZER_EMAIL,
): Promise<string> {
  const sent = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/code',
    payload: { email },
  });
  if (sent.statusCode !== 204) {
    throw new Error(`Code non envoyé : ${sent.statusCode} ${sent.body}`);
  }
  const code =
    mailbox.findLast((m) => m.to === email)?.subject.slice(0, 6) ?? '';
  const verified = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/verify',
    payload: { email, code },
  });
  return verified.json<{ accessToken: string }>().accessToken;
}

/** Matinée du tournoi en cours des données de démonstration. */
export const DEMO_NOW = new Date('2026-11-09T11:10:00+01:00');

/**
 * Limites de débit multipliées par 1000 : toutes les requêtes des tests
 * viennent de la même IP. rate-limit.e2e-spec.ts garde les vraies (1).
 */
const TEST_RATE_LIMIT_FACTOR = 1000;

/**
 * Application complète sur la base de test (DATABASE_URL), horloge figée au
 * matin du tournoi de démonstration.
 */
export async function createTestApp(
  overrides: {
    provide: symbol | string | (abstract new (...args: never[]) => unknown);
    useValue: unknown;
  }[] = [],
  { rateLimitFactor = TEST_RATE_LIMIT_FACTOR } = {},
): Promise<{
  app: NestFastifyApplication;
  prisma: PrismaService;
  reset: () => Promise<void>;
}> {
  process.env['AUTH_SECRET'] = AUTH_SECRET;
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const { provide, useValue } of overrides) {
    builder = builder.overrideProvider(provide).useValue(useValue);
  }
  const moduleRef = await builder
    .overrideProvider(Clock)
    .useValue({ now: () => new Date(DEMO_NOW) })
    .overrideProvider(MailSender)
    .useValue({
      send: async (message: MailMessage) => void mailbox.push(message),
    })
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(FASTIFY_OPTIONS),
    { rawBody: true },
  );
  await configureApp(app, { rateLimit: { factor: rateLimitFactor } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const prisma = app.get(PrismaService);
  return { app, prisma, reset: () => seedDemo(prisma) };
}
