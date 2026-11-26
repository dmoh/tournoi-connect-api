import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  cancellationPreviewSchema,
  cancellationResultSchema,
  cancelTournamentSchema,
  withdrawResultSchema,
  withdrawSchema,
  type CancellationPreview,
  type CancellationResult,
  type CancelTournament,
  type Withdraw,
  type WithdrawResult,
} from './cancellations.schemas.js';
import { CancellationsService } from './cancellations.service.js';
import { RegistrationsService } from './registrations.service.js';

/** Annulations par le club : désistement d'une équipe, annulation du tournoi. */
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
export class CancellationsController {
  constructor(
    @Inject(CancellationsService)
    private readonly cancellations: CancellationsService,
    @Inject(RegistrationsService)
    private readonly registrations: RegistrationsService,
  ) {}

  @Post('tournaments/:slug/registrations/:id/withdraw')
  @OrganizerRole('ADMIN')
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Désister une équipe (inscrite, en paiement ou en liste d’attente), remboursée ou non ; la place va à la liste d’attente',
  })
  @ApiOkResponse({ schema: openApi(withdrawResultSchema) })
  @ApiBadRequestResponse({ description: 'Corps invalide' })
  @ApiNotFoundResponse({
    description: 'Tournoi ou inscription hors du club, ou rôle insuffisant',
  })
  @ApiConflictResponse({
    description:
      'Inscription déjà close, tournoi terminé ou annulé, matchs commencés, ou requête de même clé encore en cours',
  })
  async withdraw(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Body({ schema: withdrawSchema }) body: Withdraw,
  ): Promise<WithdrawResult> {
    const { drawReset } = await this.cancellations.withdraw(
      req.organizationSlug!,
      slug,
      id,
      body.refund,
    );
    return {
      registration: await this.registrations.organizerRegistration(
        req.organizationSlug!,
        slug,
        id,
      ),
      drawReset,
    };
  }

  @Get('tournaments/:slug/cancellation')
  @OrganizerRole('OWNER')
  @ApiOperation({
    summary:
      'Avant d’annuler le tournoi : inscriptions annulées, remboursements, packs sponsors payés',
  })
  @ApiOkResponse({ schema: openApi(cancellationPreviewSchema) })
  @ApiNotFoundResponse({
    description: 'Tournoi hors du club, ou rôle insuffisant',
  })
  preview(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
  ): Promise<CancellationPreview> {
    return this.cancellations.preview(req.organizationSlug!, slug);
  }

  @Post('tournaments/:slug/cancel')
  @OrganizerRole('OWNER')
  @Idempotent()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Annuler le tournoi : équipes remboursées, responsables et suiveurs prévenus, motif affiché au public',
  })
  @ApiOkResponse({ schema: openApi(cancellationResultSchema) })
  @ApiBadRequestResponse({ description: 'Motif manquant ou trop long' })
  @ApiNotFoundResponse({
    description: 'Tournoi hors du club, ou rôle insuffisant',
  })
  @ApiConflictResponse({
    description:
      'Tournoi terminé ou déjà annulé, ou requête de même clé encore en cours',
  })
  cancel(
    @Req() req: OrganizerRequest,
    @Param('slug') slug: string,
    @Body({ schema: cancelTournamentSchema }) body: CancelTournament,
  ): Promise<CancellationResult> {
    return this.cancellations.cancelTournament(
      req.organizationSlug!,
      slug,
      body.reason,
    );
  }
}
