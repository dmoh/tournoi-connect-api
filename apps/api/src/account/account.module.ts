import { Module } from '@nestjs/common';
import { RegistrationsModule } from '../registrations/registrations.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

@Module({
  imports: [RegistrationsModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
