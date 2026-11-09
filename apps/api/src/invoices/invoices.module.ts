import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ProjectsModule } from '../projects/projects.module';
import { OrganizationModule } from '../organization/organization.module';
import { ReceiptsModule } from '../receipts/receipts.module';

@Module({
  imports: [AccountingModule, ProjectsModule, OrganizationModule, ReceiptsModule],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
