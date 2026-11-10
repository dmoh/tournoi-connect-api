import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/**
 * Process worker : même code que l'API, sans serveur HTTP. Les processeurs
 * BullMQ et les tâches planifiées s'enregistrent ici (ADR-010) ; aucun
 * traitement lourd ne tourne dans une requête HTTP.
 */
const app = await NestFactory.createApplicationContext(AppModule);
app.enableShutdownHooks();
new Logger('Worker').log('Worker démarré');
