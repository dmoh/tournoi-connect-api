import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthGuard, CurrentUser, type AuthUser } from '../auth/auth.guard.js';
import {
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  serializeCookie,
} from '../auth/cookies.js';
import { openApi } from '../common/openapi-schema.js';
import type { Env } from '../config/env.js';
import {
  accountExportSchema,
  deleteAccountSchema,
  type AccountExport,
  type DeleteAccount,
} from './account.schemas.js';
import { AccountService } from './account.service.js';

/** Mes données : export et suppression du compte (RGPD). */
@ApiTags('account')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('export')
  @ApiOperation({
    summary: 'Télécharger mes données (JSON)',
  })
  @ApiOkResponse({ schema: openApi(accountExportSchema) })
  async export(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccountExport> {
    const data = await this.account.export(user.id);
    reply.header('cache-control', 'no-store');
    reply.header(
      'content-disposition',
      'attachment; filename="tournoi-connect-mes-donnees.json"',
    );
    return data;
  }

  @Post('delete')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Supprimer mon compte (confirmé par la saisie de mon adresse)',
  })
  @ApiBody({ schema: openApi(deleteAccountSchema) })
  @ApiNoContentResponse({ description: 'Compte supprimé, session fermée' })
  @ApiBadRequestResponse({ description: 'Adresse de confirmation différente' })
  @ApiConflictResponse({
    description: 'Seul propriétaire d’un club, ou compte de test',
  })
  async delete(
    @CurrentUser() user: AuthUser,
    @Body({ schema: deleteAccountSchema }) body: DeleteAccount,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.account.delete(user.id, body.email);
    reply.header(
      'set-cookie',
      serializeCookie(REFRESH_COOKIE, '', {
        maxAgeSeconds: 0,
        path: REFRESH_COOKIE_PATH,
        secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
        sameSite: 'Strict',
      }),
    );
  }
}
