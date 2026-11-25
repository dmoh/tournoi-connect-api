import { etagMatches, etagOf } from './public-cache.js';

describe('Cache court des lectures publiques', () => {
  it('calcule un ETag fort, stable pour le même corps', () => {
    const etag = etagOf('{"a":1}');
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
    expect(etagOf(Buffer.from('{"a":1}'))).toBe(etag);
    expect(etagOf('{"a":2}')).not.toBe(etag);
  });

  it('reconnaît If-None-Match : ETag fort, faible, liste, joker', () => {
    const etag = etagOf('x');
    expect(etagMatches(undefined, etag)).toBe(false);
    expect(etagMatches(etag, etag)).toBe(true);
    expect(etagMatches(`W/${etag}`, etag)).toBe(true);
    expect(etagMatches(`"autre", ${etag}`, etag)).toBe(true);
    expect(etagMatches(['"autre"', etag], etag)).toBe(true);
    expect(etagMatches('*', etag)).toBe(true);
    expect(etagMatches('"autre"', etag)).toBe(false);
  });
});
