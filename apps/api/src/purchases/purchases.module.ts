import { Module } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { ProjectsModule } from '../projects/projects.module';
import { VendorBillsModule } from '../vendor-bills/vendor-bills.module';
import { PaymentRequestsModule } from '../payment-requests/payment-requests.module';
import { VendorPaymentsModule } from '../vendor-payments/vendor-payments.module';
import { VendorsModule } from '../vendors/vendors.module';
import { MastersModule } from '../masters/masters.module';

@Module({
  imports: [ProjectsModule, VendorBillsModule, PaymentRequestsModule, VendorPaymentsModule, VendorsModule, MastersModule],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
