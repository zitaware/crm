import { Module } from '@nestjs/common';
import { CardSettlementsService } from './card-settlements.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  providers: [CardSettlementsService],
  exports: [CardSettlementsService],
})
export class CardAccountsModule {}
