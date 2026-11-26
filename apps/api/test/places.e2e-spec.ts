import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Geocoder } from '../src/places/geocoder.js';
import type { Place } from '../src/places/places.schemas.js';
import { createTestApp } from './setup-app.js';

const MEGEVE: Place = {
  slug: 'megeve-74173',
  name: 'Megève',
  postcode: '74120',
  citycode: '74173',
  department: 'Haute-Savoie',
  lat: 45.843574,
  lng: 6.626089,
};

/** Faux géocodeur : aucune requête réseau, appels comptés. */
class FakeGeocoder extends Geocoder {
  calls: { query: string; citycode?: string }[] = [];
  down = false;
  municipalities(query: string, options: { limit: number; citycode?: string }) {
    this.calls.push({
      query,
      ...(options.citycode ? { citycode: options.citycode } : {}),
    });
    if (this.down) {
      return Promise.reject(new Error('timeout'));
    }
    return Promise.resolve(
      query.toLowerCase().startsWith('meg') &&
        (!options.citycode || options.citycode === '74173')
        ? [MEGEVE]
        : [],
    );
  }
}

describe('Communes (e2e)', () => {
  const geocoder = new FakeGeocoder();
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const ctx = await createTestApp([
      { provide: Geocoder, useValue: geocoder },
    ]);
    app = ctx.app;
  });
  afterAll(() => app.close());

  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/v1/public/places${url}` });

  it('cherche une commune, avec un cache, et la relit par son identifiant', async () => {
    const res = await get('?q=Megè');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [MEGEVE] });
    await get('?q=megè');
    // Même recherche à la casse près : servie par le cache.
    expect(
      geocoder.calls.filter((c) => c.query.toLowerCase() === 'megè'),
    ).toHaveLength(1);

    const one = await get('/megeve-74173');
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ name: 'Megève', lat: 45.843574 });
    expect(geocoder.calls.at(-1)).toEqual({
      query: 'megeve',
      citycode: '74173',
    });

    expect((await get('/megeve-99999')).statusCode).toBe(404);
    expect((await get('/pas-un-identifiant')).statusCode).toBe(404);
    // Une lettre ne suffit pas.
    expect((await get('?q=m')).statusCode).toBe(400);
  });

  it('dit que la recherche est indisponible si le géocodeur ne répond pas', async () => {
    geocoder.down = true;
    const res = await get('?q=Chamonix');
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    geocoder.down = false;
  });
});
