import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';

/**
 * Le worker n'enregistre ses processeurs qu'avec REDIS_URL : sans ce test,
 * une dépendance manquante n'apparaît qu'au démarrage du conteneur. La
 * connexion à Redis n'est pas ouverte : on résout seulement les dépendances.
 */
describe('Worker (e2e)', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });

  it('résout tous les processeurs BullMQ', async () => {
    process.env['REDIS_URL'] = 'redis://127.0.0.1:1';
    process.env['AUTH_SECRET'] = randomBytes(32).toString('base64url');
    vi.resetModules();
    const { WorkerModule } = await import('../src/worker.module.js');
    const { MaintenanceProcessor } =
      await import('../src/maintenance/maintenance.processor.js');
    const { MailProcessor } = await import('../src/mail/mail.processor.js');
    const { PushProcessor } = await import('../src/push/push.processor.js');
    const { AudienceProcessor } =
      await import('../src/audience/audience.processor.js');

    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    for (const processor of [
      MaintenanceProcessor,
      MailProcessor,
      PushProcessor,
      AudienceProcessor,
    ]) {
      expect(moduleRef.get(processor)).toBeInstanceOf(processor);
    }
    await moduleRef.close();
  });
});
