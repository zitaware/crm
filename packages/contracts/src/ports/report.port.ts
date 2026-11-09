/**
 * Phase 8 reports (ADR-108). Every report is a read-only projection of posted
 * source documents and the general ledger (docs/04 §16): it names its
 * accounting basis, and where its figures correspond to ledger control
 * accounts it carries a reconciliation of its totals against them — the two
 * Phase 8 exit criteria (docs/11).
 */

import type { TaxDeductionType, TdsCertificateSource, TdsDeductionLifecycle } from './tds-certificate.port';
import type { TdsOutwardItem } from './tds-deposit.port';

export type ReportCategory = 'RECEIVABLES' | 'PROFITABILITY' | 'GST' | 'TDS' | 'CASH' | 'PAYABLES' | 'OPERATIONS' | 'CONTROLS';
/** MULTIPLE is only for an overview whose every figure names its own basis. */
export type ReportBasis = 'ACCRUAL' | 'CASH' | 'CONTRACT_BUDGET' | 'BANK' | 'MULTIPLE' | 'CONTROLS';

export const REPORT_KEYS = [
  'receivable-aging',
  'outstanding-summary',
  'project-pl',
  'cost-to-company',
  'cash-profitability',
  'contract-performance',
  'business-overview',
  'gst-output',
  'gst-input',
  'gst-net',
  'gst-register',
  'tds-inward',
  'tds-reconciliation',
  'tds-outward',
  'cash-flow',
  'payables-aging',
  'vendor-payments',
  'expenses',
  'reimbursements',
  'employee-advances',
  'emd-sd-recovery',
  'introducer-statement',
  'penalties',
  'payment-holds',
  'pending-invoices',
  'client-payments',
  'manpower-utilization',
  'audit-activity',
  'exceptions',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type ReportExportFormat = 'XLSX' | 'PDF';

/** One read key per report category (the user's choice, ADR-108), and one key for downloads. */
export const REPORT_CATEGORY_PERMISSIONS: Record<ReportCategory, string> = {
  RECEIVABLES: 'report.receivables.read',
  PROFITABILITY: 'report.profitability.read',
  GST: 'report.gst.read',
  TDS: 'report.tds.read',
  CASH: 'report.cash.read',
  PAYABLES: 'report.payables.read',
  OPERATIONS: 'report.operations.read',
  CONTROLS: 'report.controls.read',
};
export const REPORT_EXPORT_PERMISSION = 'report.export';
export const REPORT_KEY_CATEGORIES: Record<ReportKey, ReportCategory> = {
  'receivable-aging': 'RECEIVABLES',
  'outstanding-summary': 'RECEIVABLES',
  'project-pl': 'PROFITABILITY',
  'cost-to-company': 'PROFITABILITY',
  'cash-profitability': 'PROFITABILITY',
  'contract-performance': 'PROFITABILITY',
  'business-overview': 'PROFITABILITY',
  'gst-output': 'GST',
  'gst-input': 'GST',
  'gst-net': 'GST',
  'gst-register': 'GST',
  'tds-inward': 'TDS',
  'tds-reconciliation': 'TDS',
  'tds-outward': 'TDS',
  'cash-flow': 'CASH',
  'payables-aging': 'PAYABLES',
  'vendor-payments': 'PAYABLES',
  expenses: 'PAYABLES',
  reimbursements: 'PAYABLES',
  'employee-advances': 'PAYABLES',
  'emd-sd-recovery': 'OPERATIONS',
  'introducer-statement': 'OPERATIONS',
  penalties: 'OPERATIONS',
  'payment-holds': 'OPERATIONS',
  'pending-invoices': 'OPERATIONS',
  'client-payments': 'OPERATIONS',
  'manpower-utilization': 'OPERATIONS',
  'audit-activity': 'CONTROLS',
  exceptions: 'CONTROLS',
};

export const REPORT_BASIS_LABELS: Record<ReportBasis, string> = {
  ACCRUAL: 'Accrual',
  CASH: 'Cash',
  CONTRACT_BUDGET: 'Contract/budget',
  BANK: 'Bank',
  MULTIPLE: 'Several bases',
  CONTROLS: 'Controls',
};

export interface ReportCatalogEntry {
  key: ReportKey;
  title: string;
  category: ReportCategory;
  categoryLabel: string;
  basis: ReportBasis;
  /** The full sentence stating what the figures are built from. */
  basisLabel: string;
  description: string;
  path: string;
}

export interface ReportFilters {
  legalEntityId: string | undefined;
  /** Start of the period (YYYY-MM-DD), for period reports; undefined = from the beginning. Point-in-time reports ignore it. */
  dateFrom: string | undefined;
  /** Business date the report is taken at, or the end of its period (YYYY-MM-DD). */
  asOfDate: string;
  clientId: string | undefined;
  projectId: string | undefined;
}

export interface ReportScope {
  /** Null for point-in-time reports and for a period with no start. */
  dateFrom: string | null;
  asOfDate: string;
  legalEntityId: string | null;
  legalEntityName: string | null;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  currency: 'INR';
  /** True when rows are limited to some projects — by a client/project
   * filter, or because the actor cannot see every project. The ledger has no
   * such cut, so a restricted view is not compared with it. */
  restricted: boolean;
}

export interface LedgerReconciliationLine {
  key: string;
  label: string;
  ledgerAccounts: Array<{ id: string; code: string; name: string }>;
  reportAmount: string;
  ledgerAmount: string;
  /** reportAmount − ledgerAmount. */
  difference: string;
  reconciled: boolean;
}

export interface LedgerReconciliation {
  applicable: boolean;
  notApplicableReason: string | null;
  lines: LedgerReconciliationLine[];
  allReconciled: boolean;
}

export type AgingBucket = 'NOT_DUE' | 'DAYS_0_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_90_PLUS';
export const AGING_BUCKETS: readonly AgingBucket[] = ['NOT_DUE', 'DAYS_0_30', 'DAYS_31_60', 'DAYS_61_90', 'DAYS_90_PLUS'];
export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  NOT_DUE: 'Not due',
  DAYS_0_30: '0–30 days',
  DAYS_31_60: '31–60 days',
  DAYS_61_90: '61–90 days',
  DAYS_90_PLUS: '90+ days',
};

export interface AgingBucketTotal {
  bucket: AgingBucket;
  amount: string;
  count: number;
}

export interface ReceivableAgingInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  /** Cash plus every deduction settled against the invoice by the as-of date. */
  settledAmount: string;
  /** Debit notes minus credit notes finalized by the as-of date. */
  noteAdjustmentAmount: string;
  outstandingAmount: string;
  /** Negative while the invoice is not yet due. */
  daysPastDue: number;
  bucket: AgingBucket;
}

export type HeldDeductionType = 'HOLD' | 'RETENTION';

export interface HeldDeductionAgingRow {
  deductionId: string;
  type: HeldDeductionType;
  invoiceId: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  clientName: string;
  receiptId: string;
  receiptDate: string;
  amount: string;
  releasedAmount: string;
  outstandingAmount: string;
  /** Days since the receipt that withheld it. */
  daysHeld: number;
  bucket: AgingBucket;
}

export interface ReceivableAgingReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  invoiceBuckets: AgingBucketTotal[];
  invoiceTotal: string;
  invoices: ReceivableAgingInvoiceRow[];
  heldBuckets: AgingBucketTotal[];
  heldTotal: string;
  heldDeductions: HeldDeductionAgingRow[];
  reconciliation: LedgerReconciliation;
}

export type OutstandingDeductionType = 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS' | 'HOLD' | 'RETENTION' | 'DISPUTED_PENALTY';
export type OutstandingMeasureKey = 'INVOICE_OUTSTANDING' | OutstandingDeductionType;

export interface OutstandingMeasure {
  key: OutstandingMeasureKey;
  label: string;
  amount: string;
  itemCount: number;
}

export interface OutstandingDeductionRow {
  deductionId: string;
  type: OutstandingDeductionType;
  invoiceId: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  clientName: string;
  receiptId: string;
  receiptDate: string;
  amount: string;
  releasedAmount: string;
  outstandingAmount: string;
  narrative: string | null;
}

export interface OutstandingSummaryReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  measures: OutstandingMeasure[];
  deductions: OutstandingDeductionRow[];
  reconciliation: LedgerReconciliation;
}

export type ProjectPlAccountType = 'INCOME' | 'EXPENSE';

/**
 * One project's accrual P&L for the period (ADR-109). Income and expense come
 * from posted journal lines carrying the project; manpower is the analytical
 * salary allocation, which is not posted to projects and so sits outside the
 * ledger totals.
 */
export interface ProjectPlRow {
  /** Null on the "not assigned to a project" and total rows. */
  projectId: string | null;
  projectName: string;
  clientName: string | null;
  /** Credit minus debit on income accounts — revenue net of notes and revenue deductions. */
  income: string;
  /** Debit minus credit on expense accounts. */
  expense: string;
  /** income − expense. */
  contribution: string;
  /** Null where it does not apply: the unassigned row, and the total row (salary is already in the unassigned expense). */
  manpower: string | null;
  contributionAfterManpower: string | null;
}

export interface ProjectPlAccountLine {
  ledgerAccountId: string;
  code: string;
  name: string;
  accountType: ProjectPlAccountType;
  /** In the account's natural direction: credit − debit for income, debit − credit for expense. */
  assignedAmount: string;
  unassignedAmount: string;
  totalAmount: string;
}

export interface ProjectPlReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  projects: ProjectPlRow[];
  /** Journal lines with no project; null on a restricted view. */
  unassigned: ProjectPlRow | null;
  totals: ProjectPlRow;
  accounts: ProjectPlAccountLine[];
  reconciliation: LedgerReconciliation;
}

export const COST_CATEGORIES = ['PURCHASE', 'DIRECT_EXPENSE', 'RECURRING', 'REIMBURSEMENT', 'MATERIAL', 'INTRODUCER', 'OTHER', 'MANPOWER'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  PURCHASE: 'Purchases',
  DIRECT_EXPENSE: 'Direct expenses',
  RECURRING: 'Servers & subscriptions',
  REIMBURSEMENT: 'Reimbursements',
  MATERIAL: 'Material',
  INTRODUCER: 'Introducer',
  OTHER: 'Other posted cost',
  MANPOWER: 'Manpower (analytical)',
};

export interface CostToCompanyRow {
  projectId: string;
  projectName: string;
  clientName: string | null;
  amounts: Record<CostCategory, string>;
  /** Every category except manpower — the part that is on the ledger. */
  postedTotal: string;
  total: string;
}

export interface CostToCompanyReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: CostToCompanyRow[];
  totals: Omit<CostToCompanyRow, 'projectId' | 'projectName' | 'clientName'>;
  /** Posted expense with no project (overheads, salary); null on a restricted view. */
  unassignedPostedCost: string | null;
  reconciliation: LedgerReconciliation;
}

/**
 * Cash categories (ADR-110). Each bank movement is attributed to a project
 * through the document that moved the money; what no document ties to a
 * project (salary, card settlements, unallocated receipts…) is not assigned.
 * Inflow categories count money in; every other category counts money out, so
 * a reversal or a returned deposit is a negative amount in its own category.
 */
export const CASH_CATEGORIES = [
  'CLIENT_RECEIPT',
  'DEDUCTION_RELEASE',
  'VENDOR_PAYMENT',
  'DIRECT_EXPENSE',
  'REIMBURSEMENT',
  'EMPLOYEE_ADVANCE',
  'INTRODUCER_PAYMENT',
  'SECURITY_DEPOSIT',
  'SALARY_PAYMENT',
  'TAX_DEPOSIT',
  'CARD_SETTLEMENT',
  'OTHER',
] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];
export const CASH_INFLOW_CATEGORIES: readonly CashCategory[] = ['CLIENT_RECEIPT', 'DEDUCTION_RELEASE'];
export const CASH_CATEGORY_LABELS: Record<CashCategory, string> = {
  CLIENT_RECEIPT: 'Client receipts',
  DEDUCTION_RELEASE: 'Hold/retention released',
  VENDOR_PAYMENT: 'Vendor payments',
  DIRECT_EXPENSE: 'Direct expenses',
  REIMBURSEMENT: 'Reimbursements',
  EMPLOYEE_ADVANCE: 'Employee advances',
  INTRODUCER_PAYMENT: 'Introducer payments',
  SECURITY_DEPOSIT: 'EMD/security deposits (net)',
  SALARY_PAYMENT: 'Salary payments',
  TAX_DEPOSIT: 'TDS/GST-TDS deposits',
  CARD_SETTLEMENT: 'Card settlements',
  OTHER: 'Other bank movement',
};

export interface CashProfitabilityRow {
  /** Null on the "not assigned to a project" and total rows. */
  projectId: string | null;
  projectName: string;
  clientName: string | null;
  /** Project.value (excl. GST); null where there is none. Shown for context only — never part of the formula. */
  contractValue: string | null;
  amounts: Record<CashCategory, string>;
  cashIn: string;
  cashOut: string;
  /** cashIn − cashOut. */
  netCash: string;
  /** netCash ÷ cashIn × 100, 2 dp; null when no cash came in. */
  cashMarginPercent: string | null;
}

export interface CashProfitabilityReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  projects: CashProfitabilityRow[];
  /** Bank movement no document ties to a project; null on a restricted view. */
  unassigned: CashProfitabilityRow | null;
  /** Projects plus, when shown, the unassigned row — so its net equals the bank accounts' movement. */
  totals: CashProfitabilityRow;
  reconciliation: LedgerReconciliation;
}

export interface ContractPerformanceFigures {
  /** Σ Project.value (excl. GST); null on a project with none. */
  contractValue: string | null;
  /** Revenue posted to the project up to the as-of date — the Accrual Project P&L income. */
  billedToDate: string;
  /** Of the contract value, 2 dp; null without a contract value. */
  billedPercent: string | null;
  /** contractValue − billed; negative when billed beyond the contract. Null without a contract value. */
  remainingToBill: string | null;
  budget: string | null;
  /** Posted project cost up to the as-of date (Cost to Company, posted). */
  postedCostToDate: string;
  /** Analytical manpower for allocation months up to the as-of date. */
  manpowerToDate: string;
  /** posted + manpower — the Cost to Company total. */
  costToDate: string;
  budgetUsedPercent: string | null;
  /** budget − cost; negative when over budget. Null without a budget. */
  budgetRemaining: string | null;
}

export interface ContractPerformanceRow extends ContractPerformanceFigures {
  projectId: string;
  projectName: string;
  clientName: string | null;
  stage: string;
  operationalStatus: string;
  overBudget: boolean;
}

export interface ContractPerformanceReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: ContractPerformanceRow[];
  /** Percentages and remaining amounts cover only the projects that have a contract value / budget. */
  totals: ContractPerformanceFigures & { projectsWithoutValue: number; projectsWithoutBudget: number };
  reconciliation: LedgerReconciliation;
}

export type BusinessOverviewCardKey =
  | 'ACCRUAL_INCOME'
  | 'ACCRUAL_EXPENSE'
  | 'ACCRUAL_CONTRIBUTION'
  | 'CASH_IN'
  | 'CASH_OUT'
  | 'NET_CASH'
  | 'CONTRACT_VALUE'
  | 'BILLED_TO_DATE'
  | 'REMAINING_TO_BILL'
  | 'BUDGET'
  | 'COST_TO_DATE'
  | 'BANK_OPENING'
  | 'BANK_MOVEMENT'
  | 'BANK_CLOSING';

/** One figure, carrying its own basis — the overview never blends bases into one "profit" (docs/04 §16). */
export interface BusinessOverviewCard {
  key: BusinessOverviewCardKey;
  label: string;
  basis: Exclude<ReportBasis, 'MULTIPLE'>;
  /** Null when the figure cannot be shown for this view (bank balances on a restricted view). */
  amount: string | null;
  note: string;
}

export interface BusinessOverviewProjectRow {
  projectId: string;
  projectName: string;
  clientName: string | null;
  /** Accrual, period. */
  income: string;
  /** Accrual posted cost, period, by kind. */
  costs: Record<Exclude<CostCategory, 'MANPOWER'>, string>;
  postedCost: string;
  /** Analytical, period. */
  manpower: string;
  /** income − posted cost (accrual). */
  accrualContribution: string;
  /** Cash, period. */
  cashIn: string;
  cashOut: string;
  netCash: string;
}

export interface BusinessOverviewReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  cards: BusinessOverviewCard[];
  projects: BusinessOverviewProjectRow[];
  reconciliation: LedgerReconciliation;
}

/**
 * GST reports (Phase 8.4, ADR-111). Amounts are signed as they affect the
 * period: a void, a reversal or a credit note is negative. Each document counts
 * in the tax period (calendar month) of its own journal's date, and a void or
 * reversal in the month of its own journal — the same rule as the ledger.
 */
export interface GstTaxTotals {
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  /** taxable + cgst + sgst + igst. */
  total: string;
}

export type GstOutputDocumentType = 'INVOICE' | 'INVOICE_VOID' | 'CREDIT_NOTE' | 'CREDIT_NOTE_VOID' | 'DEBIT_NOTE' | 'DEBIT_NOTE_VOID';

export interface GstOutputRow extends GstTaxTotals {
  documentType: GstOutputDocumentType;
  documentId: string;
  /** The invoice the document is, or is raised against — for drill-down. */
  invoiceId: string;
  projectId: string;
  number: string;
  ledgerDate: string;
  /** YYYY-MM. */
  taxPeriod: string;
  gstRegistrationId: string;
  gstin: string;
  buyerName: string | null;
  buyerGstin: string | null;
  placeOfSupply: string | null;
  journalEntryId: string;
}

export interface GstPeriodSummaryRow extends GstTaxTotals {
  gstRegistrationId: string | null;
  /** Null for documents that carry no GST registration (direct expenses, claims). */
  gstin: string | null;
  taxPeriod: string;
  documentCount: number;
}

export interface GstOutputReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  documents: GstOutputRow[];
  periods: GstPeriodSummaryRow[];
  totals: GstTaxTotals;
  reconciliation: LedgerReconciliation;
}

/** Input tax by component. NOT_SPLIT is an expense claim's GST credit, which is recorded as one figure. */
export interface GstInputTax {
  cgst: string;
  sgst: string;
  igst: string;
  notSplit: string;
  total: string;
}

export type GstInputDocumentType = 'VENDOR_BILL' | 'VENDOR_BILL_VOID' | 'DIRECT_EXPENSE' | 'DIRECT_EXPENSE_REVERSAL' | 'EXPENSE_CLAIM';

export interface GstInputRow {
  documentType: GstInputDocumentType;
  documentId: string;
  projectId: string | null;
  number: string;
  ledgerDate: string;
  taxPeriod: string;
  gstRegistrationId: string | null;
  gstin: string | null;
  supplierName: string | null;
  supplierGstin: string | null;
  taxable: string;
  /** Posted to Input GST receivable — claimable. */
  eligible: GstInputTax;
  /** Kept in cost or inventory (docs/06). */
  ineligible: GstInputTax;
  journalEntryId: string;
}

export interface GstInputPeriodRow {
  gstRegistrationId: string | null;
  gstin: string | null;
  taxPeriod: string;
  documentCount: number;
  taxable: string;
  eligible: GstInputTax;
  ineligible: GstInputTax;
}

/** Submitted but not yet approved — not on the ledger, so not claimable yet. */
export interface GstPendingInputRow {
  documentType: 'VENDOR_BILL' | 'EXPENSE_CLAIM';
  documentId: string;
  projectId: string | null;
  number: string;
  documentDate: string;
  status: string;
  supplierName: string | null;
  taxable: string;
  /** What would be eligible if approved as it stands. */
  eligible: GstInputTax;
}

export interface GstInputReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  documents: GstInputRow[];
  periods: GstInputPeriodRow[];
  totals: { taxable: string; eligible: GstInputTax; ineligible: GstInputTax };
  pending: GstPendingInputRow[];
  pendingTotals: { taxable: string; eligible: GstInputTax };
  reconciliation: LedgerReconciliation;
}

export type GstNetComponent = 'CGST' | 'SGST' | 'IGST' | 'NOT_SPLIT';

export interface GstNetLine {
  component: GstNetComponent | 'TOTAL';
  label: string;
  output: string;
  eligibleInput: string;
  /** GST ledger postings made by anything other than the documents above; positive raises the liability. */
  adjustments: string;
  /** output − eligible input + adjustments. */
  net: string;
}

export interface GstNetPeriodRow {
  taxPeriod: string;
  output: string;
  eligibleInput: string;
  adjustments: string;
  net: string;
}

export interface GstAdjustmentRow {
  journalEntryId: string;
  accountingDate: string;
  sourceType: string;
  description: string | null;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  component: GstNetComponent;
  /** Positive raises the net liability. */
  amount: string;
}

export interface GstNetReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  components: GstNetLine[];
  totals: GstNetLine;
  periods: GstNetPeriodRow[];
  adjustments: GstAdjustmentRow[];
  reconciliation: LedgerReconciliation;
}

export type GstRegisterDocumentType = 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'VENDOR_BILL';
export const GST_REGISTER_DOCUMENT_TYPES: readonly GstRegisterDocumentType[] = ['INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE', 'VENDOR_BILL'];

/** One tax line of a finalized (or since voided) document, as issued — amounts unsigned. */
export interface GstRegisterLine {
  direction: 'OUTWARD' | 'INWARD';
  documentType: GstRegisterDocumentType;
  documentId: string;
  invoiceId: string | null;
  /** Null for a company-overhead vendor bill (ADR-177). */
  projectId: string | null;
  number: string;
  documentDate: string;
  /** VOID only when the void is dated on or before the as-of date. */
  status: 'FINALIZED' | 'VOID';
  gstin: string;
  counterpartyName: string | null;
  counterpartyGstin: string | null;
  placeOfSupply: string | null;
  lineNumber: number;
  description: string;
  hsnSac: string | null;
  ratePercent: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
  /** Inward lines only. */
  itcEligible: boolean | null;
}

export interface GstRegisterTypeTotal extends GstTaxTotals {
  documentType: GstRegisterDocumentType;
  documentCount: number;
  lineCount: number;
}

export interface GstRegisterReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  lines: GstRegisterLine[];
  /** Per document type, excluding void documents. */
  totals: GstRegisterTypeTotal[];
  reconciliation: LedgerReconciliation;
}

/** One client TDS or GST-TDS deduction and where it stands (Phase 8.5a, ADR-112). */
export interface TdsInwardRow {
  deductionId: string;
  deductionType: TaxDeductionType;
  receiptId: string;
  receiptDate: string;
  invoiceId: string;
  invoiceNumber: string | null;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  amount: string;
  /** Matched to certificates (Form 16A, GSTR-7A) by the as-of date. */
  certificateMatched: string;
  /** Matched to statement credits (Form 26AS, GST portal) by the as-of date. */
  statementMatched: string;
  certificateReferences: string[];
  statementReferences: string[];
  /** Quarter end for TDS, month end for GST-TDS: after it, a missing certificate is pending. */
  periodEnd: string;
  lifecycle: TdsDeductionLifecycle;
  /** Some but not all of the amount is matched to one kind of credit. */
  partiallyMatched: boolean;
}

export interface TdsInwardTypeSummary {
  deductionType: TaxDeductionType;
  count: number;
  amount: string;
  certificateMatched: string;
  statementMatched: string;
  byLifecycle: Record<TdsDeductionLifecycle, { count: number; amount: string }>;
}

export interface TdsInwardReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: TdsInwardRow[];
  summary: TdsInwardTypeSummary[];
  reconciliation: LedgerReconciliation;
}

/** A certificate or statement credit with an amount no deduction accounts for. */
export interface TdsUnmatchedCreditRow {
  certificateId: string;
  source: TdsCertificateSource;
  deductionType: TaxDeductionType;
  referenceNumber: string;
  partyId: string;
  partyName: string;
  periodStart: string;
  periodEnd: string;
  creditDate: string;
  amount: string;
  matchedAmount: string;
  unmatchedAmount: string;
}

/** A match still standing against a deduction whose receipt has since been reversed. */
export interface TdsReversedReceiptMatchRow {
  matchId: string;
  certificateId: string;
  referenceNumber: string;
  deductionId: string;
  deductionType: TaxDeductionType;
  receiptId: string;
  projectId: string;
  amount: string;
}

export interface TdsReconciliationTypeSummary {
  deductionType: TaxDeductionType;
  /** Recorded on receipts, as TdsInwardReport. */
  deducted: string;
  certificateCredits: string;
  statementCredits: string;
  /** deducted − statement credits: positive is tax the government does not yet show as credited to us. */
  statementDifference: string;
}

export interface TdsReconciliationReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  summary: TdsReconciliationTypeSummary[];
  pendingCertificates: TdsInwardRow[];
  partialMatches: TdsInwardRow[];
  unmatchedCredits: TdsUnmatchedCreditRow[];
  reversedReceiptMatches: TdsReversedReceiptMatchRow[];
  totals: { pendingAmount: string; unmatchedCreditAmount: string; exceptionCount: number };
  reconciliation: LedgerReconciliation;
}

export interface TdsOutwardTypeSummary {
  deductionType: TaxDeductionType;
  count: number;
  /** Withheld from payments dated on or before the as-of date. */
  deducted: string;
  /** Deposits of this type posted by then, at their full amount. */
  deposited: string;
  /** deducted − deposited: what should still sit in the payable account. */
  payable: string;
  overdueCount: number;
  overdueAmount: string;
}

/** Vendor, introducer, direct-expense and salary TDS withheld, deposited and still payable (Phase 8.5b, ADR-113). */
export interface TdsOutwardReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: TdsOutwardItem[];
  summary: TdsOutwardTypeSummary[];
  reconciliation: LedgerReconciliation;
}

/** One bank account's month (Phase 8.6b, ADR-115): opening + money in − money out = closing. */
export interface CashFlowMonthRow {
  bankAccountId: string;
  bankAccountName: string;
  month: string;
  opening: string;
  inflow: string;
  outflow: string;
  closing: string;
  /** Of the month's book movement, how much is matched to the bank's statement. */
  matchedInflow: string;
  matchedOutflow: string;
  reconciliationStatus: 'OPEN' | 'IN_PROGRESS' | 'RECONCILED' | 'LOCKED';
}

export interface CashFlowReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  months: CashFlowMonthRow[];
  /** Per account over the whole period. */
  accounts: Array<{ bankAccountId: string; bankAccountName: string; opening: string; inflow: string; outflow: string; closing: string }>;
  totals: { opening: string; inflow: string; outflow: string; closing: string };
  /** Net bank movement over the period by kind (the Cash Profitability categories, all projects). */
  byCategory: Array<{ category: CashCategory; label: string; amount: string }>;
  reconciliation: LedgerReconciliation;
}

/* ---------------------------------------------------------------- Phase 8.7 (ADR-116) */

/** Something owed to a vendor: a finalized vendor bill, or a direct stock receipt booked to Accounts Payable. */
export interface PayablesAgingRow {
  documentType: 'VENDOR_BILL' | 'STOCK_RECEIPT';
  documentId: string;
  number: string;
  documentDate: string;
  vendorId: string | null;
  vendorName: string;
  projectId: string | null;
  projectName: string | null;
  totalAmount: string;
  /** Cash plus TDS/GST-TDS settled by vendor payments dated on or before the as-of date. */
  settledAmount: string;
  outstandingAmount: string;
  /** Still unpaid on approved payment requests (today's request status). */
  approvedForPayment: string;
  /** Days since the document date — vendor bills carry no due date. */
  ageDays: number;
  bucket: AgingBucket;
}

export interface PayablesAgingReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: PayablesAgingRow[];
  buckets: AgingBucketTotal[];
  vendors: Array<{ vendorId: string | null; vendorName: string; outstanding: string; byBucket: Record<AgingBucket, string> }>;
  total: string;
  approvedForPaymentTotal: string;
  reconciliation: LedgerReconciliation;
}

export interface TaxDeductionAmounts {
  TDS: string;
  CGST_TDS: string;
  SGST_TDS: string;
  IGST_TDS: string;
}

export interface VendorPaymentAllocationLine {
  vendorBillId: string;
  vendorBillNumber: string;
  /** Null for a company-overhead bill (ADR-177). */
  projectId: string | null;
  projectName: string | null;
  vendorName: string;
  requestedAmount: string;
  cashPaid: string;
  deductions: TaxDeductionAmounts;
  settledAmount: string;
}

/** A vendor payment, or its reversal (negative) in the period of the reversal. */
export interface VendorPaymentRow {
  paymentId: string;
  entryType: 'PAYMENT' | 'REVERSAL';
  ledgerDate: string;
  paymentDate: string;
  utrReference: string | null;
  bankAccountName: string;
  vendorNames: string[];
  cashPaid: string;
  deductions: TaxDeductionAmounts;
  settledAmount: string;
  allocations: VendorPaymentAllocationLine[];
  journalEntryId: string;
}

export interface VendorPaymentReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: VendorPaymentRow[];
  totals: { cashPaid: string; deductions: TaxDeductionAmounts; settledAmount: string };
  byVendor: Array<{ vendorName: string; cashPaid: string; deducted: string; settledAmount: string }>;
  reconciliation: LedgerReconciliation;
}

export type ExpenseSourceType = 'VENDOR_BILL_LINE' | 'VENDOR_BILL_VOID' | 'DIRECT_EXPENSE' | 'DIRECT_EXPENSE_REVERSAL' | 'EXPENSE_CLAIM';

export interface ExpenseRow {
  sourceType: ExpenseSourceType;
  documentId: string;
  documentLabel: string;
  ledgerDate: string;
  category: string;
  projectId: string | null;
  projectName: string | null;
  counterparty: string | null;
  /** What was paid or billed, GST included. */
  grossAmount: string;
  /** Input GST posted as recoverable — not expense. */
  eligibleGst: string;
  /** gross − eligible GST: what reached the expense accounts. */
  recognizedAmount: string;
  journalEntryId: string;
}

export interface ExpenseReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: ExpenseRow[];
  byCategory: Array<{ category: string; recognizedAmount: string; grossAmount: string }>;
  byProject: Array<{ projectId: string | null; projectName: string; recognizedAmount: string }>;
  totals: { grossAmount: string; eligibleGst: string; recognizedAmount: string };
  reconciliation: LedgerReconciliation;
}

export type ReimbursementStatus = 'SUBMITTED' | 'APPROVED' | 'REIMBURSED' | 'REJECTED' | 'CANCELLED';

export interface ReimbursementRow {
  claimId: string;
  employeeId: string;
  employeeName: string;
  title: string;
  category: string;
  projectId: string | null;
  projectName: string | null;
  expenseDate: string;
  amount: string;
  gstCreditAmount: string;
  /** As of the end date. */
  status: ReimbursementStatus;
  approvedOn: string | null;
  reimbursedOn: string | null;
}

export interface ReimbursementReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: ReimbursementRow[];
  totals: {
    approvedInPeriod: { count: number; amount: string };
    reimbursedInPeriod: { count: number; amount: string };
    awaitingReimbursement: { count: number; amount: string };
    awaitingApproval: { count: number; amount: string };
    rejected: { count: number; amount: string };
  };
  byEmployee: Array<{ employeeId: string; employeeName: string; approved: string; reimbursed: string; awaitingReimbursement: string }>;
  reconciliation: LedgerReconciliation;
}

/**
 * One employee's advance account (Employee Advance Receivable) over the period —
 * opening + advances − claims adjusted + reimbursements ± other = closing.
 * Positive: the employee holds company money; negative: the company owes them.
 */
export interface EmployeeAdvanceRow {
  employeeId: string | null;
  employeeName: string;
  opening: string;
  advances: string;
  claimsAdjusted: string;
  reimbursements: string;
  other: string;
  closing: string;
}

export interface EmployeeAdvanceReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: EmployeeAdvanceRow[];
  totals: Omit<EmployeeAdvanceRow, 'employeeId' | 'employeeName'>;
  reconciliation: LedgerReconciliation;
}

/** EMD/SD on the as-of date (ADR-117). OVERDUE: still lodged after its return due date. */
export type SecurityInstrumentReportStatus = 'LODGED' | 'OVERDUE' | 'RETURNED';

export interface EmdSdRow {
  instrumentId: string;
  /** From the purpose; null when the purpose has no EMD/SD category. */
  category: 'EMD' | 'SD' | null;
  purposeName: string;
  typeName: string;
  /** CASH: a cash-equivalent deposit posted to a recoverable account; GUARANTEE: contingent exposure only (docs/06). */
  exposure: 'CASH' | 'GUARANTEE';
  projectId: string | null;
  projectName: string | null;
  tenderId: string | null;
  tenderLabel: string | null;
  referenceNo: string | null;
  issuingBank: string | null;
  lodgedWithAuthority: string | null;
  amount: string;
  submittedOn: string;
  returnDueOn: string;
  returnedOn: string | null;
  status: SecurityInstrumentReportStatus;
  outstandingAmount: string;
  /** Days past the return due date while still lodged; null otherwise. */
  daysOverdue: number | null;
}

export interface EmdSdRecoveryReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: EmdSdRow[];
  byCategory: Array<{ category: 'EMD' | 'SD' | 'UNCLASSIFIED'; count: number; cashOutstanding: string; guaranteeOutstanding: string; returned: string }>;
  totals: { cashOutstanding: string; guaranteeOutstanding: string; returned: string; overdueCount: number; overdueAmount: string };
  reconciliation: LedgerReconciliation;
}

export type IntroducerStatementEntryType = 'ACCRUAL' | 'ACCRUAL_REVERSAL' | 'PAYMENT' | 'PAYMENT_REVERSAL';

/** One movement on an introducer's payable for one project, with the running balance. */
export interface IntroducerStatementLine {
  ledgerDate: string;
  entryType: IntroducerStatementEntryType;
  documentId: string;
  documentNumber: string;
  narrative: string | null;
  accrued: string;
  paid: string;
  balance: string;
  journalEntryId: string;
}

export interface IntroducerStatementAccount {
  introducerId: string;
  introducerName: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  /** e.g. "2.5% of project value" — the agreement's basis, described by the server. */
  basisDescription: string;
  /** What the agreement entitles the introducer to; null when it cannot be derived (no project value). */
  entitlement: string | null;
  accruedToDate: string;
  notYetAccrued: string | null;
  opening: string;
  accrued: string;
  paid: string;
  closing: string;
  lines: IntroducerStatementLine[];
}

export interface IntroducerStatementPayment {
  paymentId: string;
  paymentNumber: string;
  entryType: 'PAYMENT' | 'REVERSAL';
  ledgerDate: string;
  introducerName: string;
  referenceNumber: string | null;
  /** Allocated to accruals in the report's scope. */
  allocatedAmount: string;
  /** Payment-level figures; null on a filtered view, where they would include other projects. */
  grossAmount: string | null;
  advanceAmount: string | null;
  tdsAmount: string | null;
  netAmount: string | null;
}

export interface IntroducerStatementReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  accounts: IntroducerStatementAccount[];
  payments: IntroducerStatementPayment[];
  totals: { opening: string; accrued: string; paid: string; closing: string; entitlement: string; notYetAccrued: string };
  /** Unallocated excess paid, standing at the end date; null on a filtered view (not project-assigned). */
  advanceOutstanding: string | null;
  reconciliation: LedgerReconciliation;
}

/** docs/05 penalty lifecycle, as far as the product records it: accepted, or disputed and awaiting resolution. */
export type PenaltyReportStatus = 'ACCEPTED' | 'DISPUTED';

export interface PenaltyRow {
  deductionId: string;
  entryType: 'DEDUCTION' | 'REVERSAL';
  ledgerDate: string;
  status: PenaltyReportStatus;
  categoryName: string | null;
  invoiceId: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  clientName: string;
  receiptId: string;
  utrReference: string | null;
  narrative: string | null;
  amount: string;
  /** The account the deduction was posted to — its accounting treatment. */
  ledgerAccountName: string;
}

export interface PenaltyReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: PenaltyRow[];
  byCategory: Array<{ categoryName: string; accepted: string; disputed: string }>;
  totals: { accepted: string; disputed: string; acceptedCount: number; disputedCount: number };
  reconciliation: LedgerReconciliation;
}

export type HoldReportStatus = 'OUTSTANDING' | 'PARTIALLY_RELEASED' | 'RELEASED';

export interface PaymentHoldRow {
  deductionId: string;
  type: 'HOLD' | 'RETENTION';
  invoiceId: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  clientName: string;
  receiptId: string;
  receiptDate: string;
  narrative: string | null;
  amount: string;
  releasedAmount: string;
  outstandingAmount: string;
  status: HoldReportStatus;
  lastReleasedOn: string | null;
  releases: Array<{ releasedOn: string; amount: string; utrReference: string | null }>;
}

export interface PaymentHoldReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: PaymentHoldRow[];
  totals: Record<'HOLD' | 'RETENTION', { withheld: string; released: string; outstanding: string; count: number }>;
  reconciliation: LedgerReconciliation;
}

/** A finalized invoice still outstanding on the as-of date (ADR-118). */
export interface PendingInvoiceRow extends ReceivableAgingInvoiceRow {
  settlementState: 'UNSETTLED' | 'PARTIALLY_SETTLED';
}

/** Billing not yet invoiced: an open or snoozed payment alert, with its draft invoice if one is being prepared. Today's state. */
export interface BillingPendingRow {
  alertId: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  sourceType: 'CAPEX_EVENT' | 'OPEX_INSTALLMENT';
  sourceLabel: string;
  /** The milestone amount, before GST. */
  amount: string;
  dueDate: string;
  alertStatus: 'OPEN' | 'SNOOZED';
  snoozedUntil: string | null;
  draftInvoiceId: string | null;
}

export interface PendingInvoiceReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  invoices: PendingInvoiceRow[];
  buckets: AgingBucketTotal[];
  invoiceTotal: string;
  overdueTotal: string;
  billingPending: BillingPendingRow[];
  billingPendingTotal: string;
  draftInvoiceCount: number;
  reconciliation: LedgerReconciliation;
}

export type ReceiptDeductionType = 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS' | 'HOLD' | 'RETENTION' | 'ACCEPTED_PENALTY' | 'DISPUTED_PENALTY' | 'OTHER';

export interface ClientPaymentAllocationLine {
  invoiceId: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  cashAllocated: string;
  deductions: Record<ReceiptDeductionType, string>;
  settledAmount: string;
}

/** A client receipt, or its reversal (negative) in the period of the reversal. */
export interface ClientPaymentRow {
  receiptId: string;
  entryType: 'RECEIPT' | 'REVERSAL';
  ledgerDate: string;
  receiptDate: string;
  utrReference: string | null;
  bankAccountName: string;
  paymentModeName: string;
  clientNames: string[];
  /** Actual cash received into the bank. */
  actualAmount: string;
  invoiceSettled: string;
  deductions: Record<ReceiptDeductionType, string>;
  deductionTotal: string;
  /** Cash not allocated to any invoice. A receipt must allocate all its cash today, so this is zero unless that changes. */
  unallocatedCash: string;
  allocations: ClientPaymentAllocationLine[];
}

export interface ClientPaymentReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  rows: ClientPaymentRow[];
  totals: { actualAmount: string; invoiceSettled: string; deductions: Record<ReceiptDeductionType, string>; deductionTotal: string; unallocatedCash: string };
  byClient: Array<{ clientName: string; actualAmount: string; invoiceSettled: string; deductionTotal: string }>;
  reconciliation: LedgerReconciliation;
}

export type ManpowerAllocationState = 'SUBMITTED' | 'DRAFT' | 'NOT_STARTED';

export interface ManpowerUtilizationRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  /** First day of the month. */
  month: string;
  state: ManpowerAllocationState;
  projectPercentage: string;
  /** Null on a filtered view. */
  nonProjectPercentage: string | null;
  totalPercentage: string | null;
  /** totalPercentage − 100 (capacity); null on a filtered view. */
  variancePercentage: string | null;
  /** Imported gross; null when no posted salary import covers the month, or on a filtered view. */
  grossSalary: string | null;
  /** Gross × project share, SUBMITTED months only. */
  projectCost: string | null;
  nonProjectCost: string | null;
  shares: Array<{ projectId: string | null; targetName: string; percentage: string; amount: string | null }>;
}

export interface ManpowerUtilizationReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  months: string[];
  rows: ManpowerUtilizationRow[];
  byMonth: Array<{ month: string; employees: number; submitted: number; draft: number; notStarted: number; grossSalary: string; projectCost: string; nonProjectCost: string; unallocatedSalary: string }>;
  totals: { grossSalary: string; projectCost: string; nonProjectCost: string; unallocatedSalary: string };
  reconciliation: LedgerReconciliation;
}

/** Audit actions grouped by the control they evidence (ADR-120); ROUTINE is everything else. */
export type AuditActionGroup = 'CORRECTION' | 'DELETION' | 'PERIOD_CONTROL' | 'ACCESS' | 'SIGN_IN' | 'EXPORT' | 'EXCEPTION' | 'ROUTINE';

export const AUDIT_ACTION_GROUP_LABELS: Record<AuditActionGroup, string> = {
  CORRECTION: 'Reversals, voids and unmatches',
  DELETION: 'Deletions',
  PERIOD_CONTROL: 'Period locks and reopens',
  ACCESS: 'Users, roles and permissions',
  SIGN_IN: 'Sign-in failures and password resets',
  EXPORT: 'Exports and downloads',
  EXCEPTION: 'Reconciliation exceptions',
  ROUTINE: 'Routine activity',
};

export interface AuditActivityEvent {
  id: string;
  occurredAt: string;
  action: string;
  group: AuditActionGroup;
  entityType: string;
  entityId: string;
  actorEmail: string | null;
  reason: string | null;
}

export interface AuditActivityReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  totals: { events: number; sensitive: number };
  byGroup: Array<{ group: AuditActionGroup; label: string; count: number }>;
  byActor: Array<{ actorEmail: string; events: number; sensitive: number }>;
  byEntityType: Array<{ entityType: string; events: number; sensitive: number }>;
  /** Users with three or more failed sign-ins in the period. */
  repeatedSignInFailures: Array<{ userId: string; email: string | null; failures: number; lastAt: string }>;
  /** The most recent sensitive events, newest first (at most 200). */
  sensitiveEvents: AuditActivityEvent[];
  reconciliation: LedgerReconciliation;
}

export type ExceptionArea = 'LEDGER' | 'BANK' | 'TDS' | 'APPROVALS' | 'BILLING' | 'ALLOCATIONS';

export interface ExceptionItem {
  area: ExceptionArea;
  key: string;
  label: string;
  count: number;
  amount: string | null;
  oldestDate: string | null;
  href: string;
}

/** Whether one report's totals agree with the ledger on the as-of date. */
export interface LedgerCheckRow {
  reportKey: ReportKey;
  title: string;
  path: string;
  allReconciled: boolean;
  lines: Array<{ label: string; reportAmount: string; ledgerAmount: string; difference: string; reconciled: boolean }>;
}

export interface ExceptionsReport {
  catalog: ReportCatalogEntry;
  scope: ReportScope;
  ledgerChecks: LedgerCheckRow[];
  items: ExceptionItem[];
  /** Ledger checks that differ plus exception items with anything open. */
  openCount: number;
  reconciliation: LedgerReconciliation;
}

export interface ReportExportResult {
  filename: string;
  mimeType: string;
  base64: string;
}

export interface ReportReadInput {
  organizationId: string;
  actorId: string;
  canSeeAllProjects: boolean;
  filters: ReportFilters;
}

export interface ReportPort {
  getCatalog(input: { permissions: string[] }): Promise<ReportCatalogEntry[]>;
  getReceivableAging(input: ReportReadInput): Promise<ReceivableAgingReport>;
  getOutstandingSummary(input: ReportReadInput): Promise<OutstandingSummaryReport>;
  getProjectPl(input: ReportReadInput): Promise<ProjectPlReport>;
  getCostToCompany(input: ReportReadInput): Promise<CostToCompanyReport>;
  getCashProfitability(input: ReportReadInput): Promise<CashProfitabilityReport>;
  getContractPerformance(input: ReportReadInput): Promise<ContractPerformanceReport>;
  getBusinessOverview(input: ReportReadInput): Promise<BusinessOverviewReport>;
  getGstOutput(input: ReportReadInput): Promise<GstOutputReport>;
  getGstInput(input: ReportReadInput): Promise<GstInputReport>;
  getGstNet(input: ReportReadInput): Promise<GstNetReport>;
  getGstRegister(input: ReportReadInput): Promise<GstRegisterReport>;
  getTdsInward(input: ReportReadInput): Promise<TdsInwardReport>;
  getTdsReconciliation(input: ReportReadInput): Promise<TdsReconciliationReport>;
  getTdsOutward(input: ReportReadInput): Promise<TdsOutwardReport>;
  getCashFlow(input: ReportReadInput): Promise<CashFlowReport>;
  getPayablesAging(input: ReportReadInput): Promise<PayablesAgingReport>;
  getVendorPayments(input: ReportReadInput): Promise<VendorPaymentReport>;
  getExpenses(input: ReportReadInput): Promise<ExpenseReport>;
  getReimbursements(input: ReportReadInput): Promise<ReimbursementReport>;
  getEmployeeAdvances(input: ReportReadInput): Promise<EmployeeAdvanceReport>;
  getEmdSdRecovery(input: ReportReadInput): Promise<EmdSdRecoveryReport>;
  getIntroducerStatement(input: ReportReadInput): Promise<IntroducerStatementReport>;
  getPenalties(input: ReportReadInput): Promise<PenaltyReport>;
  getPaymentHolds(input: ReportReadInput): Promise<PaymentHoldReport>;
  getPendingInvoices(input: ReportReadInput): Promise<PendingInvoiceReport>;
  getClientPayments(input: ReportReadInput): Promise<ClientPaymentReport>;
  getManpowerUtilization(input: ReportReadInput): Promise<ManpowerUtilizationReport>;
  getAuditActivity(input: ReportReadInput): Promise<AuditActivityReport>;
  getExceptions(input: ReportReadInput): Promise<ExceptionsReport>;
  exportReport(
    input: ReportReadInput & {
      key: ReportKey;
      format: ReportExportFormat;
      correlationId: string;
      ipAddress: string | undefined;
      userAgent: string | undefined;
    },
  ): Promise<ReportExportResult>;
}
