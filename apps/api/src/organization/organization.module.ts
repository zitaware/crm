import { Module } from '@nestjs/common';
import { LegalEntityService } from './legal-entity.service';
import { FinancialYearService } from './financial-year.service';

@Module({
  providers: [LegalEntityService, FinancialYearService],
  exports: [LegalEntityService, FinancialYearService],
})
export class OrganizationModule {}
