import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import { StripeClient } from '../payments/stripe-client.js';
import { CancellationsController } from './cancellations.controller.js';
import { CancellationsService } from './cancellations.service.js';
import {
  OrganizerRegistrationsController,
  PublicRegistrationsController,
  RegistrationsController,
  StripeWebhookController,
} from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';
import { STRIPE } from './registrations.tokens.js';
import { WaitlistService } from './waitlist.service.js';

@Module({
  controllers: [
    PublicRegistrationsController,
    RegistrationsController,
    StripeWebhookController,
    OrganizerRegistrationsController,
    CancellationsController,
  ],
  providers: [
    RegistrationsService,
    WaitlistService,
    CancellationsService,
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
  exports: [STRIPE, WaitlistService, CancellationsService],
})
export class RegistrationsModule {}
