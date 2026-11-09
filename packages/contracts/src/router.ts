import { router } from './trpc';
import { healthRouter } from './routers/health';
import { authRouter } from './routers/auth';
import { usersRouter } from './routers/users';
import { rolesRouter } from './routers/roles';
import { geographyRouter } from './routers/geography';
import { mastersRouter } from './routers/masters';
import { legalEntitiesRouter } from './routers/legal-entities';
import { financialYearsRouter } from './routers/financial-years';
import { employeesRouter } from './routers/employees';
import { documentSupportRouter } from './routers/document-support';
import { documentsRouter } from './routers/documents';
import { penaltyCategoriesRouter } from './routers/penalty-categories';
import { inventoryItemsRouter } from './routers/inventory-items';
import { inventoryRouter } from './routers/inventory';
import { salaryImportsRouter } from './routers/salary-imports';
import { employeeAllocationsRouter } from './routers/employee-allocations';
import { introducerFeesRouter } from './routers/introducer-fees';
import { auditRouter } from './routers/audit';
import { clientsRouter } from './routers/clients';
import { introducersRouter } from './routers/introducers';
import { formDraftsRouter } from './routers/form-drafts';
import { leadsRouter } from './routers/leads';
import { tendersRouter } from './routers/tenders';
import { projectsRouter } from './routers/projects';
import { chartOfAccountsRouter } from './routers/chart-of-accounts';
import { milestonesRouter } from './routers/milestones';
import { paymentAlertsRouter } from './routers/payment-alerts';
import { journalRouter } from './routers/journal';
import { securityInstrumentsRouter } from './routers/security-instruments';
import { tdsCertificatesRouter } from './routers/tds-certificates';
import { tdsDepositsRouter } from './routers/tds-deposits';
import { bankReconciliationRouter } from './routers/bank-reconciliation';
import { invoicesRouter } from './routers/invoices';
import { creditDebitNotesRouter } from './routers/credit-debit-notes';
import { ledgerOpeningBalancesRouter } from './routers/ledger-opening-balances';
import { receiptsRouter } from './routers/receipts';
import { vendorsRouter } from './routers/vendors';
import { vendorBillsRouter } from './routers/vendor-bills';
import { paymentRequestsRouter } from './routers/payment-requests';
import { vendorPaymentsRouter } from './routers/vendor-payments';
import { employeeExpensesRouter } from './routers/employee-expenses';
import { purchasesRouter } from './routers/purchases';
import { directExpensesRouter } from './routers/direct-expenses';
import { cardSettlementsRouter } from './routers/card-settlements';
import { reportsRouter } from './routers/reports';
import { dashboardRouter } from './routers/dashboard';
import { searchRouter } from './routers/search';

export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  users: usersRouter,
  roles: rolesRouter,
  geography: geographyRouter,
  masters: mastersRouter,
  legalEntities: legalEntitiesRouter,
  financialYears: financialYearsRouter,
  employees: employeesRouter,
  documentSupport: documentSupportRouter,
  documents: documentsRouter,
  penaltyCategories: penaltyCategoriesRouter,
  inventoryItems: inventoryItemsRouter,
  inventory: inventoryRouter,
  salaryImports: salaryImportsRouter,
  employeeAllocations: employeeAllocationsRouter,
  introducerFees: introducerFeesRouter,
  audit: auditRouter,
  clients: clientsRouter,
  introducers: introducersRouter,
  formDrafts: formDraftsRouter,
  leads: leadsRouter,
  tenders: tendersRouter,
  projects: projectsRouter,
  chartOfAccounts: chartOfAccountsRouter,
  milestones: milestonesRouter,
  paymentAlerts: paymentAlertsRouter,
  journal: journalRouter,
  securityInstruments: securityInstrumentsRouter,
  tdsCertificates: tdsCertificatesRouter,
  tdsDeposits: tdsDepositsRouter,
  bankReconciliation: bankReconciliationRouter,
  invoices: invoicesRouter,
  creditDebitNotes: creditDebitNotesRouter,
  ledgerOpeningBalances: ledgerOpeningBalancesRouter,
  receipts: receiptsRouter,
  vendors: vendorsRouter,
  vendorBills: vendorBillsRouter,
  paymentRequests: paymentRequestsRouter,
  vendorPayments: vendorPaymentsRouter,
  employeeExpenses: employeeExpensesRouter,
  directExpenses: directExpensesRouter,
  purchases: purchasesRouter,
  cardSettlements: cardSettlementsRouter,
  reports: reportsRouter,
  dashboard: dashboardRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
