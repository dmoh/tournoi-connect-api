import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module } from '@nestjs/common';
import { createRedisClient } from './redis-connection.js';

/** File des événements d'audience des sponsors (impressions, clics). */
export const AUDIENCE_QUEUE = 'audience';
/** File des emails (codes de connexion, invitations) : jamais envoyés dans la requête HTTP. */
export const MAIL_QUEUE = 'mail';
/** Tâches planifiées d'exploitation (purge quotidienne des données). */
export const MAINTENANCE_QUEUE = 'maintenance';
/** File des notifications web push (coup d'envoi, buts, résultats). */
export const PUSH_QUEUE = 'push';

/**
 * Files BullMQ (ADR-010). Sans REDIS_URL (tests, poste sans Redis), aucune
 * file n'est enregistrée : les services écrivent alors directement en base.
 * L'API dépose les tâches ; le worker (worker.module.ts) les traite.
 */
@Module({})
export class QueueModule {
  static forRoot(redisUrl = process.env['REDIS_URL']): DynamicModule {
    if (!redisUrl) {
      return { module: QueueModule, global: true };
    }
    return {
      module: QueueModule,
      global: true,
      imports: [
        BullModule.forRootAsync({
          useFactory: () => ({
            connection: createRedisClient(redisUrl),
            prefix: 'tc',
          }),
        }),
        BullModule.registerQueue({
          name: MAIL_QUEUE,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
        BullModule.registerQueue({
          name: PUSH_QUEUE,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
        BullModule.registerQueue({
          name: MAINTENANCE_QUEUE,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: 30,
            removeOnFail: 100,
          },
        }),
        BullModule.registerQueue({
          name: AUDIENCE_QUEUE,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
      ],
      exports: [BullModule],
    };
  }
}
