import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthGuard, CurrentUser, type AuthUser } from '../auth/auth.guard.js';
import { Clock } from '../common/clock.js';
import { openApi } from '../common/openapi-schema.js';
import type { Env } from '../config/env.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import { verifyStripeSignature } from '../payments/stripe-signature.js';
import {
  onboardingSchema,
  organizerRegistrationSchema,
  paymentsStatusSchema,
  registerSchema,
  registrationInviteSchema,
  registrationSchema,
  type OrganizerRegistration,
  type PaymentsStatus,
  type Register,
  type RegistrationInvite,
  type RegistrationView,
} from './registrations.schemas.js';
import { RegistrationsService } from './registrations.service.js';

const IDEMPOTENCY = /^[\w-]{8,100}$/;

/** Enveloppe d'un événement Stripe ; l'objet est lu par type dans le service. */
const stripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  created: z.number().int().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

/** Lien d'inscription d'un tournoi, lisible sans connexion. */
@ApiTags('registrations')
@Controller('public/registrations')
export class PublicRegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get(':code')
  @ApiOperation({
    summary: 'Écran 08 : tournoi, prix, places et paiements du lien',
  })
  @ApiOkResponse({ schema: openApi(registrationInviteSchema) })
  @ApiNotFoundResponse({ description: 'Lien inconnu' })
  invite(@Param('code') code: string): Promise<RegistrationInvite> {
    return this.registrations.invite(code);
  }
}

/** Inscriptions du responsable d'équipe connecté. */
@ApiTags('registrations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@UseGuards(AuthGuard)
@Controller()
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Post('tournaments/:code/registrations')
  @ApiOperation({
    summary:
      'Inscrire son équipe : confirmée (gratuit), en attente de paiement (Stripe Checkout) ou en liste d’attente',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: openApi(registerSchema) })
  @ApiCreatedResponse({ schema: openApi(registrationSchema) })
  @ApiConflictResponse({ description: 'Inscriptions fermées' })
  @ApiServiceUnavailableResponse({
    description: 'Paiements du club non activés',
  })
  register(
    @Param('code') code: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body({ schema: registerSchema }) body: Register,
  ): Promise<RegistrationView> {
    if (!key || !IDEMPOTENCY.test(key)) {
      throw new BadRequestException('En-tête Idempotency-Key requis.');
    }
    return this.registrations.register(code, user, body, key);
  }

  @Get('registrations')
  @ApiOperation({
    summary: 'Mes équipes : mes inscriptions, plus récentes en tête',
  })
  @ApiOkResponse({ schema: openApi(z.array(registrationSchema)) })
  mine(@CurrentUser() user: AuthUser): Promise<RegistrationView[]> {
    return this.registrations.mine(user.id);
  }

  @Get('registrations/:id')
  @ApiOperation({ summary: 'Une de mes inscriptions (retour du paiement)' })
  @ApiOkResponse({ schema: openApi(registrationSchema) })
  @ApiNotFoundResponse({ description: 'Inscription introuvable' })
  one(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RegistrationView> {
    return this.registrations.view(id, user.id);
  }

  @Post('registrations/:id/checkout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reprendre un paiement expiré, s’il reste une place',
  })
  @ApiOkResponse({ schema: openApi(registrationSchema) })
  @ApiConflictResponse({ description: 'Inscriptions fermées' })
  retry(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<RegistrationView> {
    return this.registrations.retryCheckout(id, user.id);
  }
}

/** Événements Stripe, authentifiés par la signature du corps brut. */
@Controller('payments/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger('Stripe');

  constructor(
    private readonly registrations: RegistrationsService,
    private readonly config: ConfigService<Env, true>,
    private readonly clock: Clock,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<FastifyRequest>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const secret = this.config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!secret) {
      this.logger.error('Webhook reçu sans STRIPE_WEBHOOK_SECRET : refusé.');
    }
    if (
      !secret ||
      !verifyStripeSignature(raw, signature, secret, this.clock.now())
    ) {
      throw new UnauthorizedException('Signature Stripe invalide.');
    }
    let event: unknown;
    try {
      event = JSON.parse(raw);
    } catch {
      throw new BadRequestException('Événement Stripe illisible.');
    }
    const parsed = stripeEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new BadRequestException('Événement Stripe illisible.');
    }
    // Types non gérés : acceptés (200) sans effet, Stripe ne les renvoie pas.
    await this.registrations.handleStripeEvent({
      id: parsed.data.id,
      type: parsed.data.type,
      created: parsed.data.created ?? null,
      object: parsed.data.data.object,
    });
    return { received: true };
  }
}

/** Paiements du club et inscriptions de ses tournois. */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@ApiHeader({
  name: 'X-Organization',
  required: false,
  description: 'Club concerné (slug), si le compte en a plusieurs',
})
@UseGuards(OrganizerGuard)
@Controller('organizer')
export class OrganizerRegistrationsController {
  constructor(
    @Inject(RegistrationsService)
    private readonly registrations: RegistrationsService,
  ) {}

  @Get('tournaments/:slug/registrations')
  @ApiOperation({ summary: 'Inscriptions d’un tournoi du club' })
  @ApiOkResponse({ schema: openApi(z.array(organizerRegistrationSchema)) })
  @ApiNotFoundResponse({ description: 'Tournoi hors du club' })
  list(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<OrganizerRegistration[]> {
    return this.registrations.organizerRegistrations(
      req.organizationSlug!,
      slug,
    );
  }

  @Get('payments')
  @ApiOperation({ summary: 'Paiements en ligne du club (Stripe Connect)' })
  @ApiOkResponse({ schema: openApi(paymentsStatusSchema) })
  payments(@Req() req: OrganizerRequest): Promise<PaymentsStatus> {
    return this.registrations.paymentsStatus(req.organizationSlug!);
  }

  @Post('payments/onboarding')
  @OrganizerRole('OWNER')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activer les paiements : lien vers la vérification Stripe',
  })
  @ApiOkResponse({ schema: openApi(onboardingSchema) })
  @ApiServiceUnavailableResponse({ description: 'Paiements non configurés' })
  @ApiBadRequestResponse({ description: 'Stripe a refusé la demande' })
  onboarding(@Req() req: OrganizerRequest): Promise<{ url: string }> {
    return this.registrations.onboarding(req.organizationSlug!, req.user!);
  }
}
