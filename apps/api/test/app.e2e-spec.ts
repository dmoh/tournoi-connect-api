import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup-app.js';

describe('API (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live répond ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready vérifie Postgres', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().info.postgres.status).toBe('up');
  });

  it("pose les en-têtes de sécurité d'Helmet", async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('renvoie 404 en problem+json sur une route inconnue', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/inconnu' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 404 });
  });
});
