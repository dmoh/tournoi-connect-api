import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

/**
 * Process worker : même code que l'API, sans serveur HTTP. Les processeurs
 * BullMQ (worker.module.ts) et les tâches planifiées tournent ici (ADR-010) ;
 * aucun traitement lourd ne tourne dans une requête HTTP.
 */
const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
const logger = new Logger('Worker');
if (!process.env['REDIS_URL']) {
  logger.warn('REDIS_URL absent : aucune file traitée.');
}
logger.log('Worker démarré');
