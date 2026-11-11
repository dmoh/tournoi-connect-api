import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import { StripeClient } from '../payments/stripe-client.js';
import {
  OrganizerRegistrationsController,
  PublicRegistrationsController,
  RegistrationsController,
  StripeWebhookController,
} from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';
import { STRIPE } from './registrations.tokens.js';

@Module({
  controllers: [
    PublicRegistrationsController,
    RegistrationsController,
    StripeWebhookController,
    OrganizerRegistrationsController,
  ],
  providers: [
    RegistrationsService,
    OrganizerGuard,
    {
      provide: STRIPE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new StripeClient(
          config.get('STRIPE_SECRET_KEY', { infer: true }) ?? null,
        ),
    },
  ],
})
export class RegistrationsModule {}
