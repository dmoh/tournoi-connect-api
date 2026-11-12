import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard, CurrentUser, type AuthUser } from '../auth/auth.guard.js';
import { meSchema, type Me } from '../auth/auth.schemas.js';
import { openApi } from '../common/openapi-schema.js';
import { pageQuerySchema, type PageQuery } from '../common/pagination.js';
import { RateLimited } from '../common/rate-limit.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  createClubSchema,
  inviteMemberSchema,
  membersSchema,
  publicInvitationSchema,
  updateMemberSchema,
  type CreateClub,
  type InviteMember,
  type Members,
  type PublicInvitation,
  type UpdateMember,
} from './clubs.schemas.js';
import { ClubsService } from './clubs.service.js';

/** Création d'un club par une personne connectée, qui en devient propriétaire. */
@ApiTags('clubs')
@Controller('clubs')
export class ClubsController {
  constructor(private readonly clubs: ClubsService) {}

  @Post()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer un club (on en devient propriétaire)' })
  @ApiBody({ schema: openApi(createClubSchema) })
  @ApiCreatedResponse({
    description: 'Compte à jour, avec le nouveau club',
    schema: openApi(meSchema),
  })
  @ApiUnauthorizedResponse({ description: 'Connexion requise' })
  @ApiConflictResponse({ description: 'Nombre maximal de clubs atteint' })
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createClubSchema }) body: CreateClub,
  ): Promise<Me> {
    return this.clubs.create(user, body);
  }
}

/** Membres du club ouvert (X-Organization) et invitations en attente. */
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
export class MembersController {
  constructor(private readonly clubs: ClubsService) {}

  @Get('members')
  @OrganizerRole('STAFF')
  @ApiOperation({
    summary:
      'Membres du club (paginés, par rôle puis arrivée) et invitations en attente',
  })
  @ApiOkResponse({ schema: openApi(membersSchema) })
  @ApiBadRequestResponse({ description: 'Limite ou curseur invalide' })
  members(
    @Req() req: OrganizerRequest,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ): Promise<Members> {
    return this.clubs.members(
      req.organizationSlug!,
      req.user!,
      req.memberRole!,
      query,
    );
  }

  @Post('invitations')
  @RateLimited('invitation')
  @ApiOperation({
    summary:
      'Inviter par email (admin ; propriétaire pour inviter un propriétaire)',
  })
  @ApiBody({ schema: openApi(inviteMemberSchema) })
  @ApiCreatedResponse({ schema: openApi(membersSchema) })
  @ApiConflictResponse({ description: 'Déjà membre du club' })
  @ApiTooManyRequestsResponse({
    description: 'Plus de 30 invitations par heure',
  })
  invite(
    @Req() req: OrganizerRequest,
    @Body({ schema: inviteMemberSchema }) body: InviteMember,
  ): Promise<Members> {
    return this.clubs.invite(
      req.organizationSlug!,
      req.user!,
      req.memberRole!,
      body,
    );
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Annuler une invitation en attente' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Invitation introuvable' })
  revoke(@Req() req: OrganizerRequest, @Param('id') id: string): Promise<void> {
    return this.clubs.revoke(req.organizationSlug!, id);
  }

  @Patch('members/:userId')
  @OrganizerRole('OWNER')
  @ApiOperation({ summary: 'Changer le rôle d’un membre (propriétaire)' })
  @ApiBody({ schema: openApi(updateMemberSchema) })
  @ApiOkResponse({ schema: openApi(membersSchema) })
  @ApiBadRequestResponse({ description: 'Dernier propriétaire du club' })
  @ApiNotFoundResponse({ description: 'Membre introuvable' })
  updateRole(
    @Req() req: OrganizerRequest,
    @Param('userId') userId: string,
    @Body({ schema: updateMemberSchema }) body: UpdateMember,
  ): Promise<Members> {
    return this.clubs.updateRole(
      req.organizationSlug!,
      req.user!,
      userId,
      body,
    );
  }

  @Delete('members/:userId')
  @OrganizerRole('STAFF')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retirer un membre, ou quitter le club (son propre identifiant)',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Dernier propriétaire du club' })
  @ApiNotFoundResponse({
    description: 'Membre introuvable ou rôle insuffisant',
  })
  remove(
    @Req() req: OrganizerRequest,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.clubs.remove(
      req.organizationSlug!,
      req.user!,
      req.memberRole!,
      userId,
    );
  }
}

/** Lien d'invitation reçu par email. */
@ApiTags('clubs')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly clubs: ClubsService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Invitation lue par son lien (sans connexion)' })
  @ApiOkResponse({ schema: openApi(publicInvitationSchema) })
  @ApiNotFoundResponse({ description: 'Lien inconnu' })
  invitation(@Param('token') token: string): Promise<PublicInvitation> {
    return this.clubs.invitation(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Rejoindre le club avec le compte de l’adresse invitée',
  })
  @ApiOkResponse({
    description: 'Compte à jour, avec le club rejoint',
    schema: openApi(meSchema),
  })
  @ApiUnauthorizedResponse({ description: 'Connexion requise' })
  @ApiNotFoundResponse({
    description: 'Invitation expirée, annulée ou utilisée',
  })
  @ApiConflictResponse({ description: 'Compte d’une autre adresse' })
  accept(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser,
  ): Promise<Me> {
    return this.clubs.accept(token, user);
  }
}
