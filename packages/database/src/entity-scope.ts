import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Entity-wise data (ADR-172). A request made by a user without
 * `legal_entity.access_all` runs inside a scope naming the legal entities it
 * may see (the one on the user's own employee record, or none). Every read
 * and update the Prisma client makes inside that scope is narrowed to those
 * legal entities. Outside a scope (Admin, the worker, scripts, the seed)
 * nothing is narrowed.
 */
export interface EntityScope {
  legalEntityIds: string[];
}

const storage = new AsyncLocalStorage<EntityScope | null>();

export function withEntityScope<T>(scope: EntityScope | null, fn: () => T): T {
  return storage.run(scope, fn);
}

/**
 * Runs without the scope, for the few reads that must see the whole
 * organization even for a scoped user: a document number counted across the
 * organization, which another legal entity's documents also use.
 */
export function unscoped<T>(fn: () => T): T {
  return storage.run(null, fn);
}

export function currentEntityScope(): EntityScope | null {
  return storage.getStore() ?? null;
}

/** ADR-174: the Admin behind a request made while viewing as another user. */
const impersonator = new AsyncLocalStorage<string | null>();

export function withImpersonator<T>(adminUserId: string | null, fn: () => T): T {
  return impersonator.run(adminUserId, fn);
}

export function currentImpersonator(): string | null {
  return impersonator.getStore() ?? null;
}

type Where = Record<string, unknown>;

/** Models carrying their own legal entity. A null one (an unassigned employee, an organization-level audit event) stays visible. */
const DIRECT = [
  'GstRegistration', 'FinancialYear', 'InventoryReceipt', 'InventoryConsumption', 'SalaryImport', 'SalaryPayment', 'IntroducerAgreement',
  'IntroducerPayment', 'Project', 'LedgerOpeningBalance', 'JournalEntry', 'SecurityInstrument', 'Invoice', 'CreditDebitNote', 'BankAccount',
  'ClientReceipt', 'VendorBill', 'PaymentRequest', 'VendorPayment', 'EmployeeAdvance', 'EmployeeExpenseClaim', 'DirectExpense', 'CardAccount',
  'TdsCertificate', 'TdsDeposit',
];
const NULLABLE = ['Employee', 'AuditEvent'];

/** Models reaching a legal entity through a required parent: model -> [relation field, parent model]. */
const VIA: Record<string, [string, string]> = {
  AccountingPeriod: ['financialYear', 'FinancialYear'],
  BankReconciliationMatch: ['bankAccount', 'BankAccount'],
  BankReconciliationPeriod: ['bankAccount', 'BankAccount'],
  BankStatementImport: ['bankAccount', 'BankAccount'],
  BankStatementLine: ['bankAccount', 'BankAccount'],
  BankStatementProfile: ['bankAccount', 'BankAccount'],
  CardSettlement: ['cardAccount', 'CardAccount'],
  CreditDebitNoteLine: ['creditDebitNote', 'CreditDebitNote'],
  DeductionRelease: ['bankAccount', 'BankAccount'],
  EmployeeExpenseClaimDecision: ['claim', 'EmployeeExpenseClaim'],
  EmployeeMonthlyAllocation: ['employee', 'Employee'],
  EmployeeSalaryRevision: ['employee', 'Employee'],
  IntroducerAccrual: ['agreement', 'IntroducerAgreement'],
  IntroducerPaymentAllocation: ['payment', 'IntroducerPayment'],
  InventoryConsumptionLine: ['inventoryConsumption', 'InventoryConsumption'],
  InventoryReceiptLine: ['inventoryReceipt', 'InventoryReceipt'],
  InvoiceCapexSource: ['invoice', 'Invoice'],
  InvoiceLine: ['invoice', 'Invoice'],
  JournalLine: ['journalEntry', 'JournalEntry'],
  PaymentAlert: ['project', 'Project'],
  PaymentRequestDecision: ['paymentRequest', 'PaymentRequest'],
  PaymentRequestLine: ['paymentRequest', 'PaymentRequest'],
  ProjectMilestone: ['project', 'Project'],
  ProjectProgress: ['project', 'Project'],
  ProjectTeamMember: ['project', 'Project'],
  ReceiptAllocation: ['receipt', 'ClientReceipt'],
  SalaryImportLine: ['salaryImport', 'SalaryImport'],
  SalaryPaymentLine: ['payment', 'SalaryPayment'],
  TdsCertificateMatch: ['certificate', 'TdsCertificate'],
  TdsDepositAllocation: ['deposit', 'TdsDeposit'],
  VendorBillDecision: ['vendorBill', 'VendorBill'],
  VendorBillLine: ['vendorBill', 'VendorBill'],
  VendorPaymentAllocation: ['payment', 'VendorPayment'],
  // Two levels down.
  AccountingPeriodTransition: ['accountingPeriod', 'AccountingPeriod'],
  EmployeeAllocationLine: ['allocation', 'EmployeeMonthlyAllocation'],
  MilestoneEvent: ['milestone', 'ProjectMilestone'],
  MilestoneInstallment: ['milestone', 'ProjectMilestone'],
  AllocationDeduction: ['allocation', 'ReceiptAllocation'],
  VendorPaymentDeduction: ['allocation', 'VendorPaymentAllocation'],
};

/** The filter a model gets for these legal entities, or null when it has no legal entity (masters, clients, vendors, leads). */
export function entityFilter(model: string, ids: string[]): Where | null {
  if (model === 'LegalEntity') return { id: { in: ids } };
  if (DIRECT.includes(model)) return { legalEntityId: { in: ids } };
  if (NULLABLE.includes(model)) return { OR: [{ legalEntityId: { in: ids } }, { legalEntityId: null }] };
  const via = VIA[model];
  if (!via) return null;
  const parent = entityFilter(via[1], ids);
  return parent ? { [via[0]]: parent } : null;
}

/** The operations narrowed. A create is checked by the service's own lookup of the legal entity or project it names, which is narrowed. */
export const SCOPED_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'delete', 'deleteMany',
]);

export function withEntityFilter(where: Where | undefined, filter: Where): Where {
  if (!where) return filter;
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...where, AND: [...and, filter] };
}
