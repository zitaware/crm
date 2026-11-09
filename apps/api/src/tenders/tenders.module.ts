import { Module } from '@nestjs/common';
import { TendersService } from './tenders.service';

@Module({
  providers: [TendersService],
  exports: [TendersService],
})
export class TendersModule {}
