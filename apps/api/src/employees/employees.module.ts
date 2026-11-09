import { Module } from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { EmployeeSalaryRevisionsService } from './employee-salary-revisions.service';

@Module({
  providers: [EmployeesService, EmployeeSalaryRevisionsService],
  exports: [EmployeesService, EmployeeSalaryRevisionsService],
})
export class EmployeesModule {}
