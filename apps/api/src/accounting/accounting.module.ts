import { Module } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { PostingService } from './posting.service';

@Module({
  providers: [ChartOfAccountsService, PostingService],
  exports: [ChartOfAccountsService, PostingService],
})
export class AccountingModule {}
