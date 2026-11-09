import { Module } from '@nestjs/common';
import { CreditDebitNotesService } from './credit-debit-notes.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [AccountingModule, ProjectsModule],
  providers: [CreditDebitNotesService],
  exports: [CreditDebitNotesService],
})
export class CreditDebitNotesModule {}
