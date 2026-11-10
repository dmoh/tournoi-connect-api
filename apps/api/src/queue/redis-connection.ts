import { Redis, type RedisOptions } from 'ioredis';

/**
 * Options ioredis tirées de REDIS_URL
 * (redis://[utilisateur:motdepasse@]hôte[:port][/base]).
 * maxRetriesPerRequest à null : exigé par les workers BullMQ.
 */
export function redisOptions(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`REDIS_URL doit commencer par redis:// ou rediss://.`);
  }
  const db = url.pathname.replace('/', '');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: db ? Number(db) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/**
 * Client partagé par les files. En ESM, BullMQ demande un client déjà
 * construit (il le duplique pour les connexions bloquantes des workers).
 */
export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisOptions(redisUrl));
}
