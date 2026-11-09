import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { IntroducerFeesService } from './introducer-fees.service';

@Module({
  imports: [AccountingModule],
  providers: [IntroducerFeesService],
  exports: [IntroducerFeesService],
})
export class IntroducerFeesModule {}
