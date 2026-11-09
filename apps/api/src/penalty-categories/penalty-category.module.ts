import { Module } from '@nestjs/common';
import { PenaltyCategoryService } from './penalty-category.service';

@Module({
  providers: [PenaltyCategoryService],
  exports: [PenaltyCategoryService],
})
export class PenaltyCategoryModule {}
