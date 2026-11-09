import { Module } from '@nestjs/common';
import { SecurityInstrumentsService } from './security-instruments.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  providers: [SecurityInstrumentsService],
  exports: [SecurityInstrumentsService],
})
export class SecurityInstrumentsModule {}
