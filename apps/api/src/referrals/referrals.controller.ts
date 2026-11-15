import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerGuard,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  publicReferralSchema,
  referralSchema,
  type PublicReferral,
  type Referral,
} from './referrals.schemas.js';
import { ReferralsService } from './referrals.service.js';

/** Parrainage du club ouvert (admins et propriétaire). */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@ApiHeader({
  name: 'X-Organization',
  required: false,
  description: 'Club concerné (slug), si le compte en a plusieurs',
})
@UseGuards(OrganizerGuard)
@Controller('organizer/referral')
export class OrganizerReferralController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @ApiOperation({ summary: 'Lien de parrainage du club et clubs parrainés' })
  @ApiOkResponse({ schema: openApi(referralSchema) })
  referral(@Req() req: OrganizerRequest): Promise<Referral> {
    return this.referrals.forClub(req.organizationSlug!);
  }
}

/** Club parrain d'un lien, affiché à la création d'un club. */
@ApiTags('public')
@Controller('public/referrals')
export class PublicReferralController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get(':code')
  @ApiOperation({ summary: 'Club qui a partagé ce lien de parrainage' })
  @ApiOkResponse({ schema: openApi(publicReferralSchema) })
  @ApiNotFoundResponse({ description: 'Code inconnu' })
  lookup(@Param('code') code: string): Promise<PublicReferral> {
    return this.referrals.lookup(code);
  }
}
