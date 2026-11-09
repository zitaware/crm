import { Module } from '@nestjs/common';
import { DirectExpensesService } from './direct-expenses.service';
import { ServerSubscriptionImportService } from './server-subscription-import.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  providers: [DirectExpensesService, ServerSubscriptionImportService],
  exports: [DirectExpensesService, ServerSubscriptionImportService],
})
export class DirectExpensesModule {}
