import { describe, expect, it } from 'vitest';
import { redisOptions } from './redis-connection.js';

describe('redisOptions', () => {
  it('lit hôte et port par défaut', () => {
    expect(redisOptions('redis://redis')).toMatchObject({
      host: 'redis',
      port: 6379,
      db: 0,
      maxRetriesPerRequest: null,
    });
  });

  it('lit identifiants, base et TLS', () => {
    expect(
      redisOptions('rediss://app:p%40ss@cache.local:6380/2'),
    ).toMatchObject({
      host: 'cache.local',
      port: 6380,
      username: 'app',
      password: 'p@ss',
      db: 2,
      tls: {},
    });
  });

  it('refuse un autre protocole', () => {
    expect(() => redisOptions('http://redis')).toThrow(/REDIS_URL/);
  });
});
