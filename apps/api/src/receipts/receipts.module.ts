import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [AccountingModule, ProjectsModule],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
