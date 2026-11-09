import { Module } from '@nestjs/common';
import { PaymentAlertsService } from './payment-alerts.service';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProjectsModule],
  providers: [PaymentAlertsService],
  exports: [PaymentAlertsService],
})
export class PaymentAlertsModule {}
