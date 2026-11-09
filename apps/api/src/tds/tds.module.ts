import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { TdsCertificatesService } from './tds-certificates.service';
import { TdsDepositsService } from './tds-deposits.service';

@Module({
  imports: [AccountingModule],
  providers: [TdsCertificatesService, TdsDepositsService],
  exports: [TdsCertificatesService, TdsDepositsService],
})
export class TdsModule {}
