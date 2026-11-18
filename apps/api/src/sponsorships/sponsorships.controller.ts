import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerGuard,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  checkoutUrlSchema,
  inviteLinkSchema,
  sponsorCheckoutSchema,
  sponsorInvitationSchema,
  type InviteLink,
  type SponsorCheckout,
  type SponsorInvitation,
} from './sponsorships.schemas.js';
import { SponsorshipsService } from './sponsorships.service.js';

/** Page de paiement d'un sponsor, ouverte par son lien personnel (sans compte). */
@ApiTags('public')
@ApiNotFoundResponse({ description: 'Lien invalide ou remplacé' })
@Controller('public/sponsor-invitations/:token')
export class PublicSponsorshipsController {
  constructor(private readonly sponsorships: SponsorshipsService) {}

  @Get()
  @ApiOperation({
    summary: 'Pack proposé au sponsor, prix et état du paiement',
  })
  @ApiOkResponse({ schema: openApi(sponsorInvitationSchema) })
  view(@Param('token') token: string): Promise<SponsorInvitation> {
    return this.sponsorships.view(token);
  }

  @Post('checkout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Page de paiement Stripe du pack (versé au club)' })
  @ApiBody({ schema: openApi(sponsorCheckoutSchema) })
  @ApiOkResponse({ schema: openApi(checkoutUrlSchema) })
  @ApiConflictResponse({ description: 'Pack déjà payé ou plus proposé' })
  @ApiServiceUnavailableResponse({
    description: 'Le club n’encaisse pas en ligne',
  })
  checkout(
    @Param('token') token: string,
    @Body({ schema: sponsorCheckoutSchema }) body: SponsorCheckout,
  ): Promise<{ url: string }> {
    return this.sponsorships.checkout(token, body.email);
  }
}

/** Renvoi du lien de paiement à un sponsor invité (admins du club). */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@UseGuards(OrganizerGuard)
@Controller('organizer/tournament-sponsors/:id')
export class OrganizerSponsorshipsController {
  constructor(private readonly sponsorships: SponsorshipsService) {}

  @Post('invite-link')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Nouveau lien de paiement (l’ancien ne marche plus), envoyé par email au sponsor',
  })
  @ApiOkResponse({ schema: openApi(inviteLinkSchema) })
  @ApiNotFoundResponse({ description: 'Sponsor hors du club' })
  @ApiConflictResponse({ description: 'Sponsor déjà payé' })
  inviteLink(
    @Req() req: OrganizerRequest,
    @Param('id') id: string,
  ): Promise<InviteLink> {
    return this.sponsorships.inviteLink(req.organizationSlug!, id);
  }
}
