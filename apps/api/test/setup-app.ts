import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { Clock } from '../src/common/clock.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { seedDemo } from '../src/database/seed.js';

/** Jeton organisateur des tests (jamais utilisé hors des tests). */
export const ORGANIZER_TOKEN = 'jeton-de-test-organisateur-0123456789';

/** Matinée du tournoi en cours des données de démonstration. */
export const DEMO_NOW = new Date('2026-11-09T11:10:00+01:00');

/**
 * Application complète sur la base de test (DATABASE_URL), horloge figée au
 * matin du tournoi de démonstration.
 */
export async function createTestApp(): Promise<{
  app: NestFastifyApplication;
  prisma: PrismaService;
  reset: () => Promise<void>;
}> {
  process.env['ORGANIZER_DEMO_TOKEN'] = ORGANIZER_TOKEN;
  process.env['ORGANIZER_DEMO_ORG'] = 'etoile-de-l-arve';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue({ now: () => new Date(DEMO_NOW) })
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const prisma = app.get(PrismaService);
  return { app, prisma, reset: () => seedDemo(prisma) };
}
