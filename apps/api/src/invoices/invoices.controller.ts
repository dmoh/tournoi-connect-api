import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Page, PageQuery } from '../common/pagination.js';
import { openApi } from '../common/openapi-schema.js';
import {
  OrganizerGuard,
  OrganizerRole,
  type OrganizerRequest,
} from '../organizer/organizer.guard.js';
import {
  billingProfileInputSchema,
  billingProfileSchema,
  invoicePageQuerySchema,
  invoicePageSchema,
  invoiceSchema,
  issueInvoiceSchema,
  type BillingProfile,
  type BillingProfileInput,
  type InvoiceSummary,
  type InvoiceView,
  type IssueInvoice,
} from './invoices.schemas.js';
import { InvoicesService } from './invoices.service.js';

/** Identité de facturation du club et factures des packs sponsors. */
@ApiTags('organizer')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Connexion requise' })
@UseGuards(OrganizerGuard)
@Controller('organizer')
export class OrganizerInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('billing')
  @ApiOperation({
    summary: 'Identité de facturation du club et prochain numéro de facture',
  })
  @ApiOkResponse({ schema: openApi(billingProfileSchema) })
  profile(@Req() req: OrganizerRequest): Promise<BillingProfile> {
    return this.invoices.profile(req.organizationSlug!);
  }

  @Put('billing')
  @OrganizerRole('OWNER')
  @ApiOperation({
    summary:
      'Renseigne l’identité légale du club (raison sociale, siège, SIRET ou RNA, TVA)',
  })
  @ApiBody({ schema: openApi(billingProfileInputSchema) })
  @ApiOkResponse({ schema: openApi(billingProfileSchema) })
  updateProfile(
    @Req() req: OrganizerRequest,
    @Body({ schema: billingProfileInputSchema }) body: BillingProfileInput,
  ): Promise<BillingProfile> {
    return this.invoices.updateProfile(req.organizationSlug!, body);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Factures du club, les plus récentes en premier' })
  @ApiOkResponse({ schema: openApi(invoicePageSchema) })
  list(
    @Req() req: OrganizerRequest,
    @Query({ schema: invoicePageQuerySchema }) query: PageQuery,
  ): Promise<Page<InvoiceSummary>> {
    return this.invoices.list(req.organizationSlug!, query);
  }

  @Get('invoices/:number')
  @ApiOperation({ summary: 'Une facture du club' })
  @ApiOkResponse({ schema: openApi(invoiceSchema) })
  @ApiNotFoundResponse({ description: 'Facture hors du club' })
  get(
    @Req() req: OrganizerRequest,
    @Param('number') number: string,
  ): Promise<InvoiceView> {
    return this.invoices.get(req.organizationSlug!, number);
  }

  @Post('tournament-sponsors/:id/invoice')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Établit la facture d’un pack payé (ou rend celle déjà émise) et l’envoie au sponsor',
  })
  @ApiBody({ schema: openApi(issueInvoiceSchema) })
  @ApiOkResponse({ schema: openApi(invoiceSchema) })
  @ApiNotFoundResponse({ description: 'Sponsor hors du club' })
  @ApiConflictResponse({
    description:
      'Pack non payé, identité du club incomplète ou adresse du sponsor inconnue',
  })
  issue(
    @Req() req: OrganizerRequest,
    @Param('id') id: string,
    @Body({ schema: issueInvoiceSchema }) body: IssueInvoice,
  ): Promise<InvoiceView> {
    return this.invoices.issueForClub(req.organizationSlug!, id, body.buyer);
  }
}

/** Facture consultée par le sponsor avec son lien personnel (sans compte). */
@ApiTags('public')
@Controller('public/invoices')
export class PublicInvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Facture d’un pack sponsor (lien personnel)' })
  @ApiOkResponse({ schema: openApi(invoiceSchema) })
  @ApiNotFoundResponse({ description: 'Lien invalide' })
  view(@Param('token') token: string): Promise<InvoiceView> {
    return this.invoices.byToken(token);
  }
}
