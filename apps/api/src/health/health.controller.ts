import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { PrismaService } from '../database/prisma.service.js';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /** Le process répond : utilisé par la sonde de vie du conteneur. */
  @Get('live')
  @ApiOperation({ summary: 'Sonde de vie' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * L'instance peut recevoir du trafic : Postgres répond. L'indicateur Redis
   * s'ajoutera avec BullMQ.
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Sonde de disponibilité' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('postgres', this.prisma),
    ]);
  }
}
