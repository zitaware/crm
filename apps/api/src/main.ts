import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadEnv, createLogger } from '@zitaware/config';
import type { Services } from '@zitaware/contracts';
import { AppModule } from './app.module';
import { NestStructuredLogger } from './nest-logger';
import { mountTrpc } from './trpc/mount-trpc';
import { IdentityService } from './identity/identity.service';
import { UsersService } from './rbac/users.service';
import { RolesService } from './rbac/roles.service';
import { GeographyService } from './geography/geography.service';
import { MastersService } from './masters/masters.service';
import { PenaltyCategoryService } from './penalty-categories/penalty-category.service';
import { InventoryItemsService } from './inventory-items/inventory-items.service';
import { InventoryService } from './inventory/inventory.service';
import { SalaryImportsService } from './salary-imports/salary-imports.service';
import { EmployeeSalaryRevisionsService } from './employees/employee-salary-revisions.service';
import { EmployeeAllocationsService } from './employee-allocations/employee-allocations.service';
import { IntroducerFeesService } from './introducer-fees/introducer-fees.service';
import { LegalEntityService } from './organization/legal-entity.service';
import { FinancialYearService } from './organization/financial-year.service';
import { EmployeesService } from './employees/employees.service';
import { DocumentSupportService } from './document-support/document-support.service';
import { DocumentsService } from './documents/documents.service';
import { AuditService } from './audit/audit.service';
import { ClientsService } from './clients/clients.service';
import { IntroducersService } from './introducers/introducers.service';
import { FormDraftsService } from './form-drafts/form-drafts.service';
import { LeadsService } from './leads/leads.service';
import { TendersService } from './tenders/tenders.service';
import { ProjectsService } from './projects/projects.service';
import { ProjectFinancialsService } from './projects/project-financials.service';
import { ChartOfAccountsService } from './accounting/chart-of-accounts.service';
import { PostingService } from './accounting/posting.service';
import { MilestonesService } from './milestones/milestones.service';
import { PaymentAlertsService } from './payment-alerts/payment-alerts.service';
import { SecurityInstrumentsService } from './security-instruments/security-instruments.service';
import { TdsCertificatesService } from './tds/tds-certificates.service';
import { TdsDepositsService } from './tds/tds-deposits.service';
import { BankReconciliationService } from './bank-reconciliation/bank-reconciliation.service';
import { InvoicesService } from './invoices/invoices.service';
import { CreditDebitNotesService } from './credit-debit-notes/credit-debit-notes.service';
import { LedgerOpeningBalancesService } from './ledger-opening-balances/ledger-opening-balances.service';
import { ReceiptsService } from './receipts/receipts.service';
import { VendorsService } from './vendors/vendors.service';
import { VendorBillsService } from './vendor-bills/vendor-bills.service';
import { PaymentRequestsService } from './payment-requests/payment-requests.service';
import { VendorPaymentsService } from './vendor-payments/vendor-payments.service';
import { PurchasesService } from './purchases/purchases.service';
import { EmployeeExpensesService } from './employee-expenses/employee-expenses.service';
import { DirectExpensesService } from './direct-expenses/direct-expenses.service';
import { ServerSubscriptionImportService } from './direct-expenses/server-subscription-import.service';
import { CardSettlementsService } from './card-accounts/card-settlements.service';
import { ReportsService } from './reports/reports.service';
import { DashboardService } from './reports/dashboard.service';
import { SearchService } from './search/search.service';

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger({ service: 'api' });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestStructuredLogger(),
    bodyParser: false,
  });
  // Three branding images (PNG/JPEG, up to 5 MB each, base64 ≈ +33%) travel
  // on the legal-entity create/update body before going to S3 (ADR-193).
  // The default 100 KB parser rejects that payload.
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '25mb' });

  app.enableCors({
    origin: env.ALLOWED_ORIGINS.split(',').map((origin: string) => origin.trim()),
    credentials: true,
  });

  const services: Services = {
    auth: app.get(IdentityService),
    users: app.get(UsersService),
    roles: app.get(RolesService),
    geography: app.get(GeographyService),
    masters: app.get(MastersService),
    penaltyCategories: app.get(PenaltyCategoryService),
    inventoryItems: app.get(InventoryItemsService),
    inventory: app.get(InventoryService),
    salaryImports: app.get(SalaryImportsService),
    employeeSalaryRevisions: app.get(EmployeeSalaryRevisionsService),
    employeeAllocations: app.get(EmployeeAllocationsService),
    introducerFees: app.get(IntroducerFeesService),
    legalEntities: app.get(LegalEntityService),
    financialYears: app.get(FinancialYearService),
    employees: app.get(EmployeesService),
    documentSupport: app.get(DocumentSupportService),
    documents: app.get(DocumentsService),
    audit: app.get(AuditService),
    clients: app.get(ClientsService),
    introducers: app.get(IntroducersService),
    formDrafts: app.get(FormDraftsService),
    leads: app.get(LeadsService),
    tenders: app.get(TendersService),
    projects: app.get(ProjectsService),
    projectFinancials: app.get(ProjectFinancialsService),
    chartOfAccounts: app.get(ChartOfAccountsService),
    milestones: app.get(MilestonesService),
    paymentAlerts: app.get(PaymentAlertsService),
    journal: app.get(PostingService),
    securityInstruments: app.get(SecurityInstrumentsService),
    tdsCertificates: app.get(TdsCertificatesService),
    tdsDeposits: app.get(TdsDepositsService),
    bankReconciliation: app.get(BankReconciliationService),
    invoices: app.get(InvoicesService),
    creditDebitNotes: app.get(CreditDebitNotesService),
    ledgerOpeningBalances: app.get(LedgerOpeningBalancesService),
    receipts: app.get(ReceiptsService),
    vendors: app.get(VendorsService),
    vendorBills: app.get(VendorBillsService),
    paymentRequests: app.get(PaymentRequestsService),
    vendorPayments: app.get(VendorPaymentsService),
    purchases: app.get(PurchasesService),
    employeeExpenses: app.get(EmployeeExpensesService),
    directExpenses: app.get(DirectExpensesService),
    serverSubscriptionImports: app.get(ServerSubscriptionImportService),
    cardSettlements: app.get(CardSettlementsService),
    reports: app.get(ReportsService),
    dashboard: app.get(DashboardService),
    search: app.get(SearchService),
  };

  mountTrpc(app.getHttpAdapter().getInstance(), services, 4 * 1024 * 1024);

  await app.listen(env.API_PORT);
  logger.info('api.listening', { port: env.API_PORT });
}

void bootstrap();
