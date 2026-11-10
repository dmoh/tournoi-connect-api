import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module } from '@nestjs/common';
import { createRedisClient } from './redis-connection.js';

/** File des événements d'audience des sponsors (impressions, clics). */
export const AUDIENCE_QUEUE = 'audience';

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
