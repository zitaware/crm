import { Module } from '@nestjs/common';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryService } from './inventory.service';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports: [AccountingModule],
  providers: [InventoryLedgerService, InventoryService],
  exports: [InventoryLedgerService, InventoryService],
})
export class InventoryModule {}
