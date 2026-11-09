import { Module } from '@nestjs/common';
import { MilestonesService } from './milestones.service';
import { ProjectsModule } from '../projects/projects.module';
import { PaymentAlertsModule } from '../payment-alerts/payment-alerts.module';

@Module({
  imports: [ProjectsModule, PaymentAlertsModule],
  providers: [MilestonesService],
  exports: [MilestonesService],
})
export class MilestonesModule {}
