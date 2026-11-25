import { Global, Module } from '@nestjs/common';
import { OrganizerGuard } from '../organizer/organizer.guard.js';
import {
  OrganizerInvoicesController,
  PublicInvoicesController,
} from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';

/** Factures des packs sponsors (le règlement d'un pack en émet une). */
@Global()
@Module({
  controllers: [OrganizerInvoicesController, PublicInvoicesController],
  providers: [InvoicesService, OrganizerGuard],
  exports: [InvoicesService],
})
export class InvoicesModule {}
