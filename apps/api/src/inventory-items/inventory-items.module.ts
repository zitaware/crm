import { Module } from '@nestjs/common';
import { InventoryItemsService } from './inventory-items.service';

@Module({
  providers: [InventoryItemsService],
  exports: [InventoryItemsService],
})
export class InventoryItemsModule {}
