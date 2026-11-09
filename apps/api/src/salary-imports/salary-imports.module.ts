import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { EmployeesModule } from '../employees/employees.module';
import { SalaryImportsService } from './salary-imports.service';

@Module({
  imports: [AccountingModule, EmployeesModule],
  providers: [SalaryImportsService],
  exports: [SalaryImportsService],
})
export class SalaryImportsModule {}
