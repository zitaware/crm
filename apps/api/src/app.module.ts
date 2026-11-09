import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './identity/identity.module';
import { RbacModule } from './rbac/rbac.module';
import { GeographyModule } from './geography/geography.module';
import { MastersModule } from './masters/masters.module';
import { PenaltyCategoryModule } from './penalty-categories/penalty-category.module';
import { InventoryItemsModule } from './inventory-items/inventory-items.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalaryImportsModule } from './salary-imports/salary-imports.module';
import { EmployeeAllocationsModule } from './employee-allocations/employee-allocations.module';
import { IntroducerFeesModule } from './introducer-fees/introducer-fees.module';
import { OrganizationModule } from './organization/organization.module';
import { EmployeesModule } from './employees/employees.module';
import { DocumentSupportModule } from './document-support/document-support.module';
import { DocumentsModule } from './documents/documents.module';
import { AuditModule } from './audit/audit.module';
import { ClientsModule } from './clients/clients.module';
import { IntroducersModule } from './introducers/introducers.module';
import { FormDraftsModule } from './form-drafts/form-drafts.module';
import { LeadsModule } from './leads/leads.module';
import { TendersModule } from './tenders/tenders.module';
import { ProjectsModule } from './projects/projects.module';
import { AccountingModule } from './accounting/accounting.module';
import { MilestonesModule } from './milestones/milestones.module';
import { PaymentAlertsModule } from './payment-alerts/payment-alerts.module';
import { SecurityInstrumentsModule } from './security-instruments/security-instruments.module';
import { TdsModule } from './tds/tds.module';
import { BankReconciliationModule } from './bank-reconciliation/bank-reconciliation.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CreditDebitNotesModule } from './credit-debit-notes/credit-debit-notes.module';
import { LedgerOpeningBalancesModule } from './ledger-opening-balances/ledger-opening-balances.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { VendorsModule } from './vendors/vendors.module';
import { VendorBillsModule } from './vendor-bills/vendor-bills.module';
import { PaymentRequestsModule } from './payment-requests/payment-requests.module';
import { VendorPaymentsModule } from './vendor-payments/vendor-payments.module';
import { PurchasesModule } from './purchases/purchases.module';
import { EmployeeExpensesModule } from './employee-expenses/employee-expenses.module';
import { DirectExpensesModule } from './direct-expenses/direct-expenses.module';
import { CardAccountsModule } from './card-accounts/card-accounts.module';
import { ReportsModule } from './reports/reports.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    IdentityModule,
    RbacModule,
    GeographyModule,
    MastersModule,
    PenaltyCategoryModule,
    InventoryItemsModule,
    InventoryModule,
    SalaryImportsModule,
    EmployeeAllocationsModule,
    IntroducerFeesModule,
    OrganizationModule,
    EmployeesModule,
    DocumentSupportModule,
    DocumentsModule,
    AuditModule,
    ClientsModule,
    IntroducersModule,
    FormDraftsModule,
    LeadsModule,
    TendersModule,
    ProjectsModule,
    AccountingModule,
    MilestonesModule,
    PaymentAlertsModule,
    SecurityInstrumentsModule,
    TdsModule,
    BankReconciliationModule,
    InvoicesModule,
    CreditDebitNotesModule,
    LedgerOpeningBalancesModule,
    ReceiptsModule,
    VendorsModule,
    VendorBillsModule,
    PaymentRequestsModule,
    VendorPaymentsModule,
    PurchasesModule,
    EmployeeExpensesModule,
    DirectExpensesModule,
    CardAccountsModule,
    ReportsModule,
    SearchModule,
  ],
})
export class AppModule {}
