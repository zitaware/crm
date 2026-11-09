import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { EmployeeAllocationsService } from './employee-allocations.service';

@Module({
  imports: [ProjectsModule],
  providers: [EmployeeAllocationsService],
  exports: [EmployeeAllocationsService],
})
export class EmployeeAllocationsModule {}
