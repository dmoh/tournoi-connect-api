import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, mailbox } from './setup-app.js';

/** Code fixe des comptes de test en préprod (TEST_ACCOUNTS_CODE et ALLOW_TEST_ACCOUNTS). */
describe('Comptes de test (e2e)', () => {
  const CODE = '246810';
  let app: NestFastifyApplication;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    process.env['TEST_ACCOUNTS_CODE'] = CODE;
    process.env['ALLOW_TEST_ACCOUNTS'] = 'true';
    const ctx = await createTestApp();
    app = ctx.app;
    reset = ctx.reset;
  });
  beforeEach(() => reset());
  afterAll(async () => {
    delete process.env['TEST_ACCOUNTS_CODE'];
    delete process.env['ALLOW_TEST_ACCOUNTS'];
    await app.close();
  });

  const signIn = async (email: string, code: string) => {
    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/code',
      payload: { email },
    });
    expect(sent.statusCode).toBe(204);
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { email, code },
    });
  };

  it('ouvre un compte de test avec le code fixe, sans envoyer d’email', async () => {
    const before = mailbox.length;
    const res = await signIn('admin@example.org', CODE);
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      firstName: 'Nadia',
      memberships: [{ role: 'ADMIN' }],
    });
    expect(mailbox.length).toBe(before);
  });

  it('garde les limites d’essais du code fixe', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/code',
      payload: { email: 'orga@example.org' },
    });
    for (let i = 0; i < 5; i++) {
      const wrong = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify',
        payload: { email: 'orga@example.org', code: '000000' },
      });
      expect(wrong.statusCode).toBe(400);
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { email: 'orga@example.org', code: CODE },
    });
    expect(blocked.statusCode).toBe(400);
  });

  it('n’accepte pas le code fixe pour une autre adresse', async () => {
    const res = await signIn('quelquun@example.com', CODE);
    expect(res.statusCode).toBe(400);
    expect(
      mailbox.findLast((m) => m.to === 'quelquun@example.com'),
    ).toBeDefined();
  });
});
