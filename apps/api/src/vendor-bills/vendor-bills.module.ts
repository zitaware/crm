import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { VendorBillsService } from './vendor-bills.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [AccountingModule, ProjectsModule, InventoryModule],
  providers: [VendorBillsService],
  exports: [VendorBillsService],
})
export class VendorBillsModule {}
