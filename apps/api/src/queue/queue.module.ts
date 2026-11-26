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
/** Liste d'attente : promotion quand une place se libère, échéance des places proposées. */
export const WAITLIST_QUEUE = 'waitlist';
/** Remboursements des annulations par le club (désistement, tournoi annulé). */
export const REFUND_QUEUE = 'refund';
/** Convocations des équipes : balayage horaire des tournois à J-2. */
export const CONVOCATION_QUEUE = 'convocation';
/** Édition suivante : invitation des équipes de l'édition précédente. */
export const EDITION_QUEUE = 'edition';

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
          name: WAITLIST_QUEUE,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        }),
        BullModule.registerQueue({
          name: EDITION_QUEUE,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        }),
        BullModule.registerQueue({
          name: CONVOCATION_QUEUE,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        }),
        BullModule.registerQueue({
          name: REFUND_QUEUE,
          defaultJobOptions: {
            attempts: 6,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
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
