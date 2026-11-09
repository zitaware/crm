import { Module } from '@nestjs/common';
import { LedgerOpeningBalancesService } from './ledger-opening-balances.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  providers: [LedgerOpeningBalancesService],
  exports: [LedgerOpeningBalancesService],
})
export class LedgerOpeningBalancesModule {}
