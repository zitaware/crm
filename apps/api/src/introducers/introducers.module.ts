import { Module } from '@nestjs/common';
import { IntroducersService } from './introducers.service';

@Module({
  providers: [IntroducersService],
  exports: [IntroducersService],
})
export class IntroducersModule {}
