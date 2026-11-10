import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from '@nestjs/terminus';

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  /** Le process répond : utilisé par la sonde de vie du conteneur. */
  @Get('live')
  @ApiOperation({ summary: 'Sonde de vie' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * L'instance peut recevoir du trafic. Les indicateurs Postgres et Redis
   * s'ajoutent ici avec le schéma P0.
   */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Sonde de disponibilité' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
