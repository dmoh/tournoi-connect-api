import { Module } from '@nestjs/common';
import { AudienceWriter } from './audience-writer.js';

@Module({
  providers: [AudienceWriter],
  exports: [AudienceWriter],
})
export class AudienceModule {}
