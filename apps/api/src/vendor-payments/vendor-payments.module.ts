import { Module } from '@nestjs/common';
import { VendorPaymentsService } from './vendor-payments.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [AccountingModule, ProjectsModule],
  providers: [VendorPaymentsService],
  exports: [VendorPaymentsService],
})
export class VendorPaymentsModule {}
