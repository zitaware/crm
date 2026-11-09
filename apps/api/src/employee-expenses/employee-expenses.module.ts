import { Module } from '@nestjs/common';
import { EmployeeExpensesService } from './employee-expenses.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  providers: [EmployeeExpensesService],
  exports: [EmployeeExpensesService],
})
export class EmployeeExpensesModule {}
