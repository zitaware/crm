import { Module } from '@nestjs/common';
import { MastersService } from './masters.service';

@Module({
  providers: [MastersService],
  exports: [MastersService],
})
export class MastersModule {}
