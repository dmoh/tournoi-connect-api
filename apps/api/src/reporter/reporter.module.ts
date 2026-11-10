import { Module } from '@nestjs/common';
import { ReporterController } from './reporter.controller.js';
import { ReporterService } from './reporter.service.js';

@Module({
  controllers: [ReporterController],
  providers: [ReporterService],
  exports: [ReporterService],
})
export class ReporterModule {}
