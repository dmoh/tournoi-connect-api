import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';

describe('API (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live répond ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready répond ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it("pose les en-têtes de sécurité d'Helmet", async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('renvoie 404 sur une route inconnue', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/inconnu' });
    expect(res.statusCode).toBe(404);
  });
});
