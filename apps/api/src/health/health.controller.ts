import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Optional, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import type { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { AUDIENCE_QUEUE } from '../queue/queue.module.js';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly indicators: HealthIndicatorService,
    @Optional()
    @InjectQueue(AUDIENCE_QUEUE)
    private readonly queue?: Queue,
  ) {}

  /** Le process répond : utilisé par la sonde de vie du conteneur. */
  @Get('live')
  @ApiOperation({ summary: 'Sonde de vie' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * L'instance peut recevoir du trafic : Postgres répond, et Redis aussi
   * quand les files BullMQ sont configurées.
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Sonde de disponibilité' })
  ready(): Promise<HealthCheckResult> {
    const queue = this.queue;
    return this.health.check([
      () => this.db.pingCheck('postgres', this.prisma),
      ...(queue ? [() => this.redisCheck(queue)] : []),
    ]);
  }

  private async redisCheck(queue: Queue) {
    const indicator = this.indicators.check('redis');
    try {
      // Aller-retour réel vers Redis, borné à 2 s.
      await Promise.race([
        queue.getJobCounts('waiting'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Redis ne répond pas')), 2000),
        ),
      ]);
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
