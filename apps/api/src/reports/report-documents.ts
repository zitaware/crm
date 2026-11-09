import { AGING_BUCKET_LABELS, CASH_CATEGORIES, CASH_CATEGORY_LABELS, COST_CATEGORIES, COST_CATEGORY_LABELS, REPORT_BASIS_LABELS } from '@zitaware/contracts';
import type {
  BusinessOverviewReport,
  AuditActivityReport,
  ExceptionsReport,
  ClientPaymentReport,
  ManpowerUtilizationReport,
  PendingInvoiceReport,
  ReceiptDeductionType,
  EmdSdRecoveryReport,
  IntroducerStatementReport,
  PaymentHoldReport,
  PenaltyReport,
  EmployeeAdvanceReport,
  ExpenseReport,
  PayablesAgingReport,
  ReimbursementReport,
  VendorPaymentReport,
  CashProfitabilityReport,
  ContractPerformanceReport,
  CostToCompanyReport,
  GstInputReport,
  GstInputTax,
  GstNetReport,
  GstOutputReport,
  GstRegisterReport,
  LedgerReconciliation,
  TaxDeductionType,
  TdsDeductionLifecycle,
  TdsInwardReport,
  TdsInwardRow,
  CashFlowReport,
  TdsOutwardReport,
  TdsReconciliationReport, OutstandingSummaryReport, ProjectPlReport, ReceivableAgingReport, ReportScope } from '@zitaware/contracts';
import type { ReportDocument, ReportSection } from './report-export.service';
import { formatDisplayDate } from '../common/display-date.util';

/** The header lines every exported report carries (docs/04 §16: legal entity, as-of date, currency, basis). */
function scopeDetails(scope: ReportScope, reconciliation: LedgerReconciliation): string[] {
  return [
    scope.dateFrom ? `Period: ${formatDisplayDate(scope.dateFrom)} to ${formatDisplayDate(scope.asOfDate)}` : `As of: ${formatDisplayDate(scope.asOfDate)}`,
    `Legal entity: ${scope.legalEntityName ?? 'All legal entities'}`,
    ...(scope.clientName ? [`Client: ${scope.clientName}`] : []),
    ...(scope.projectName ? [`Project: ${scope.projectName}`] : []),
    `Currency: ${scope.currency}`,
    reconciliation.applicable
      ? reconciliation.allReconciled
        ? 'Ledger reconciliation: every total agrees with the ledger.'
        : 'Ledger reconciliation: DIFFERENCES — see the Reconciliation section.'
      : `Ledger reconciliation: not applicable — ${reconciliation.notApplicableReason ?? ''}`,
  ];
}

function reconciliationSection(reconciliation: LedgerReconciliation): ReportSection[] {
  if (!reconciliation.applicable) return [];
  return [
    {
      title: 'Reconciliation',
      columns: [
        { key: 'label', label: 'Figure', kind: 'text' },
        { key: 'accounts', label: 'Ledger account', kind: 'text' },
        { key: 'reportAmount', label: 'Report total', kind: 'money' },
        { key: 'ledgerAmount', label: 'Ledger balance', kind: 'money' },
        { key: 'difference', label: 'Difference', kind: 'money' },
        { key: 'status', label: 'Status', kind: 'text' },
      ],
      rows: reconciliation.lines.map((l) => ({
        label: l.label,
        accounts: l.ledgerAccounts.map((a) => a.code).join(', '),
        reportAmount: l.reportAmount,
        ledgerAmount: l.ledgerAmount,
        difference: l.difference,
        status: l.reconciled ? 'Agrees' : 'Differs',
      })),
    },
  ];
}

export function agingDocument(report: ReceivableAgingReport): ReportDocument {
  const heldByBucket = new Map(report.heldBuckets.map((b) => [b.bucket, b]));
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Summary',
        columns: [
          { key: 'bucket', label: 'Age', kind: 'text' },
          { key: 'invoiceCount', label: 'Invoices', kind: 'number' },
          { key: 'invoiceAmount', label: 'Invoice outstanding', kind: 'money' },
          { key: 'heldCount', label: 'Held items', kind: 'number' },
          { key: 'heldAmount', label: 'Hold/retention outstanding', kind: 'money' },
        ],
        rows: report.invoiceBuckets.map((b) => ({
          bucket: AGING_BUCKET_LABELS[b.bucket],
          invoiceCount: b.count,
          invoiceAmount: b.amount,
          heldCount: heldByBucket.get(b.bucket)?.count ?? 0,
          heldAmount: heldByBucket.get(b.bucket)?.amount ?? '0.00',
        })),
        totals: { invoiceAmount: report.invoiceTotal, heldAmount: report.heldTotal },
      },
      {
        title: 'Invoices',
        columns: [
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'invoiceDate', label: 'Invoice date', kind: 'date' },
          { key: 'dueDate', label: 'Due date', kind: 'date' },
          { key: 'totalAmount', label: 'Invoice total', kind: 'money' },
          { key: 'settledAmount', label: 'Settled', kind: 'money' },
          { key: 'noteAdjustmentAmount', label: 'Notes', kind: 'money' },
          { key: 'outstandingAmount', label: 'Outstanding', kind: 'money' },
          { key: 'daysPastDue', label: 'Days past due', kind: 'number' },
          { key: 'bucket', label: 'Age', kind: 'text' },
        ],
        rows: report.invoices.map((r) => ({ ...r, bucket: AGING_BUCKET_LABELS[r.bucket] })),
        totals: { outstandingAmount: report.invoiceTotal },
      },
      {
        title: 'Hold and retention',
        columns: [
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'receiptDate', label: 'Withheld on', kind: 'date' },
          { key: 'amount', label: 'Withheld', kind: 'money' },
          { key: 'releasedAmount', label: 'Released', kind: 'money' },
          { key: 'outstandingAmount', label: 'Outstanding', kind: 'money' },
          { key: 'daysHeld', label: 'Days held', kind: 'number' },
          { key: 'bucket', label: 'Age', kind: 'text' },
        ],
        rows: report.heldDeductions.map((r) => ({ ...r, bucket: AGING_BUCKET_LABELS[r.bucket] })),
        totals: { outstandingAmount: report.heldTotal },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function outstandingSummaryDocument(report: OutstandingSummaryReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Summary',
        columns: [
          { key: 'label', label: 'Measure', kind: 'text' },
          { key: 'itemCount', label: 'Items', kind: 'number' },
          { key: 'amount', label: 'Amount', kind: 'money' },
        ],
        rows: report.measures.map((m) => ({ label: m.label, itemCount: m.itemCount, amount: m.amount })),
      },
      {
        title: 'Deductions',
        columns: [
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'receiptDate', label: 'Receipt date', kind: 'date' },
          { key: 'amount', label: 'Deducted', kind: 'money' },
          { key: 'releasedAmount', label: 'Released', kind: 'money' },
          { key: 'outstandingAmount', label: 'Outstanding', kind: 'money' },
          { key: 'narrative', label: 'Note', kind: 'text' },
        ],
        rows: report.deductions.map((d) => ({ ...d })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function projectPlDocument(report: ProjectPlReport): ReportDocument {
  const rows = [...report.projects, ...(report.unassigned ? [report.unassigned] : [])];
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Projects',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'income', label: 'Income', kind: 'money' },
          { key: 'expense', label: 'Expense', kind: 'money' },
          { key: 'contribution', label: 'Contribution', kind: 'money' },
          { key: 'manpower', label: 'Manpower (analytical)', kind: 'money' },
          { key: 'contributionAfterManpower', label: 'After manpower', kind: 'money' },
        ],
        rows: rows.map((r) => ({ ...r })),
        totals: { income: report.totals.income, expense: report.totals.expense, contribution: report.totals.contribution },
      },
      {
        title: 'By ledger account',
        columns: [
          { key: 'accountType', label: 'Type', kind: 'text' },
          { key: 'code', label: 'Account code', kind: 'text' },
          { key: 'name', label: 'Account', kind: 'text' },
          { key: 'assignedAmount', label: 'On projects', kind: 'money' },
          { key: 'unassignedAmount', label: 'Not assigned', kind: 'money' },
          { key: 'totalAmount', label: 'Total', kind: 'money' },
        ],
        rows: report.accounts.map((a) => ({ ...a })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function costToCompanyDocument(report: CostToCompanyReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: [
      ...scopeDetails(report.scope, report.reconciliation),
      ...(report.unassignedPostedCost !== null ? [`Posted cost not assigned to a project: ${report.unassignedPostedCost}`] : []),
    ],
    sections: [
      {
        title: 'Projects',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          ...COST_CATEGORIES.map((c) => ({ key: c, label: COST_CATEGORY_LABELS[c], kind: 'money' as const })),
          { key: 'postedTotal', label: 'Posted total', kind: 'money' },
          { key: 'total', label: 'Total', kind: 'money' },
        ],
        rows: report.rows.map((r) => ({ projectName: r.projectName, clientName: r.clientName, ...r.amounts, postedTotal: r.postedTotal, total: r.total })),
        totals: { ...report.totals.amounts, postedTotal: report.totals.postedTotal, total: report.totals.total },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

/** A percentage the server computed, as text — the renderer only formats. */
function percent(value: string | null): string {
  return value === null ? '—' : `${value}%`;
}

export function cashProfitabilityDocument(report: CashProfitabilityReport): ReportDocument {
  const rows = [...report.projects, ...(report.unassigned ? [report.unassigned] : [])];
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Projects',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'contractValue', label: 'Contract value', kind: 'money' },
          { key: 'cashIn', label: 'Cash in', kind: 'money' },
          { key: 'cashOut', label: 'Cash out', kind: 'money' },
          { key: 'netCash', label: 'Net cash', kind: 'money' },
          { key: 'cashMargin', label: 'Cash margin', kind: 'text' },
        ],
        rows: rows.map((r) => ({ projectName: r.projectName, clientName: r.clientName, contractValue: r.contractValue, cashIn: r.cashIn, cashOut: r.cashOut, netCash: r.netCash, cashMargin: percent(r.cashMarginPercent) })),
        totals: { cashIn: report.totals.cashIn, cashOut: report.totals.cashOut, netCash: report.totals.netCash },
      },
      {
        title: 'By kind of movement',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          ...CASH_CATEGORIES.map((c) => ({ key: c, label: CASH_CATEGORY_LABELS[c], kind: 'money' as const })),
        ],
        rows: rows.map((r) => ({ projectName: r.projectName, ...r.amounts })),
        totals: { ...report.totals.amounts },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function contractPerformanceDocument(report: ContractPerformanceReport): ReportDocument {
  const t = report.totals;
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: [
      ...scopeDetails(report.scope, report.reconciliation),
      ...(t.projectsWithoutValue ? [`Projects without a contract value: ${t.projectsWithoutValue}`] : []),
      ...(t.projectsWithoutBudget ? [`Projects without a budget: ${t.projectsWithoutBudget}`] : []),
    ],
    sections: [
      {
        title: 'Projects',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'contractValue', label: 'Contract value', kind: 'money' },
          { key: 'billedToDate', label: 'Billed to date', kind: 'money' },
          { key: 'billed', label: 'Billed %', kind: 'text' },
          { key: 'remainingToBill', label: 'Remaining to bill', kind: 'money' },
          { key: 'budget', label: 'Budget', kind: 'money' },
          { key: 'postedCostToDate', label: 'Posted cost', kind: 'money' },
          { key: 'manpowerToDate', label: 'Manpower', kind: 'money' },
          { key: 'costToDate', label: 'Cost to date', kind: 'money' },
          { key: 'budgetUsed', label: 'Budget used %', kind: 'text' },
          { key: 'budgetRemaining', label: 'Budget remaining', kind: 'money' },
          { key: 'status', label: 'Status', kind: 'text' },
        ],
        rows: report.rows.map((r) => ({
          projectName: r.projectName,
          clientName: r.clientName,
          contractValue: r.contractValue,
          billedToDate: r.billedToDate,
          remainingToBill: r.remainingToBill,
          budget: r.budget,
          postedCostToDate: r.postedCostToDate,
          manpowerToDate: r.manpowerToDate,
          costToDate: r.costToDate,
          budgetRemaining: r.budgetRemaining,
          billed: percent(r.billedPercent),
          budgetUsed: percent(r.budgetUsedPercent),
          status: r.budget === null ? 'No budget' : r.overBudget ? 'Over budget' : 'Within budget',
        })),
        totals: {
          contractValue: t.contractValue,
          billedToDate: t.billedToDate,
          billed: percent(t.billedPercent),
          remainingToBill: t.remainingToBill,
          budget: t.budget,
          postedCostToDate: t.postedCostToDate,
          manpowerToDate: t.manpowerToDate,
          costToDate: t.costToDate,
          budgetUsed: percent(t.budgetUsedPercent),
          budgetRemaining: t.budgetRemaining,
        },
      },
    ],
  };
}

export function businessOverviewDocument(report: BusinessOverviewReport): ReportDocument {
  const postedCategories = COST_CATEGORIES.filter((c) => c !== 'MANPOWER');
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Figures by basis',
        columns: [
          { key: 'basis', label: 'Basis', kind: 'text' },
          { key: 'label', label: 'Figure', kind: 'text' },
          { key: 'amount', label: 'Amount', kind: 'money' },
          { key: 'note', label: 'What it is', kind: 'text' },
        ],
        rows: report.cards.map((c) => ({ basis: REPORT_BASIS_LABELS[c.basis], label: c.label, amount: c.amount, note: c.note })),
      },
      {
        title: 'Projects',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'income', label: 'Income (accrual)', kind: 'money' },
          ...postedCategories.map((c) => ({ key: c, label: COST_CATEGORY_LABELS[c], kind: 'money' as const })),
          { key: 'postedCost', label: 'Posted cost', kind: 'money' },
          { key: 'accrualContribution', label: 'Accrual contribution', kind: 'money' },
          { key: 'manpower', label: 'Manpower (analytical)', kind: 'money' },
          { key: 'cashIn', label: 'Cash in', kind: 'money' },
          { key: 'cashOut', label: 'Cash out', kind: 'money' },
          { key: 'netCash', label: 'Net cash', kind: 'money' },
        ],
        rows: report.projects.map((r) => ({
          projectName: r.projectName,
          income: r.income,
          ...r.costs,
          postedCost: r.postedCost,
          accrualContribution: r.accrualContribution,
          manpower: r.manpower,
          cashIn: r.cashIn,
          cashOut: r.cashOut,
          netCash: r.netCash,
        })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const GST_OUTPUT_TYPE_LABELS: Record<string, string> = {
  INVOICE: 'Invoice',
  INVOICE_VOID: 'Invoice void',
  CREDIT_NOTE: 'Credit note',
  CREDIT_NOTE_VOID: 'Credit note void',
  DEBIT_NOTE: 'Debit note',
  DEBIT_NOTE_VOID: 'Debit note void',
  VENDOR_BILL: 'Vendor bill',
  VENDOR_BILL_VOID: 'Vendor bill void',
  DIRECT_EXPENSE: 'Direct expense',
  DIRECT_EXPENSE_REVERSAL: 'Direct expense reversal',
  EXPENSE_CLAIM: 'Expense claim',
};

const taxColumns = [
  { key: 'taxable', label: 'Taxable', kind: 'money' as const },
  { key: 'cgst', label: 'CGST', kind: 'money' as const },
  { key: 'sgst', label: 'SGST', kind: 'money' as const },
  { key: 'igst', label: 'IGST', kind: 'money' as const },
  { key: 'total', label: 'Total', kind: 'money' as const },
];

export function gstOutputDocument(report: GstOutputReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By registration and tax period',
        columns: [
          { key: 'gstin', label: 'GSTIN', kind: 'text' },
          { key: 'taxPeriod', label: 'Tax period', kind: 'text' },
          { key: 'documentCount', label: 'Documents', kind: 'number' },
          ...taxColumns,
        ],
        rows: report.periods.map((p) => ({ gstin: p.gstin, taxPeriod: p.taxPeriod, documentCount: p.documentCount, taxable: p.taxable, cgst: p.cgst, sgst: p.sgst, igst: p.igst, total: p.total })),
        totals: { ...report.totals },
      },
      {
        title: 'Documents',
        columns: [
          { key: 'ledgerDate', label: 'Date', kind: 'date' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'number', label: 'Number', kind: 'text' },
          { key: 'gstin', label: 'GSTIN', kind: 'text' },
          { key: 'buyerName', label: 'Buyer', kind: 'text' },
          { key: 'buyerGstin', label: 'Buyer GSTIN', kind: 'text' },
          { key: 'placeOfSupply', label: 'Place of supply', kind: 'text' },
          ...taxColumns,
        ],
        rows: report.documents.map((r) => ({
          ledgerDate: r.ledgerDate, type: GST_OUTPUT_TYPE_LABELS[r.documentType] ?? r.documentType, number: r.number, gstin: r.gstin, buyerName: r.buyerName, buyerGstin: r.buyerGstin, placeOfSupply: r.placeOfSupply,
          taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst, total: r.total,
        })),
        totals: { ...report.totals },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const inputTaxCells = (prefix: string, t: GstInputTax) => ({ [`${prefix}Cgst`]: t.cgst, [`${prefix}Sgst`]: t.sgst, [`${prefix}Igst`]: t.igst, [`${prefix}NotSplit`]: t.notSplit, [`${prefix}Total`]: t.total });
const inputTaxColumns = (prefix: string, label: string) => [
  { key: `${prefix}Cgst`, label: `${label} CGST`, kind: 'money' as const },
  { key: `${prefix}Sgst`, label: `${label} SGST`, kind: 'money' as const },
  { key: `${prefix}Igst`, label: `${label} IGST`, kind: 'money' as const },
  { key: `${prefix}NotSplit`, label: `${label} claim credit`, kind: 'money' as const },
  { key: `${prefix}Total`, label: `${label} total`, kind: 'money' as const },
];

export function gstInputDocument(report: GstInputReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By registration and tax period',
        columns: [
          { key: 'gstin', label: 'GSTIN', kind: 'text' },
          { key: 'taxPeriod', label: 'Tax period', kind: 'text' },
          { key: 'documentCount', label: 'Documents', kind: 'number' },
          { key: 'taxable', label: 'Taxable', kind: 'money' },
          ...inputTaxColumns('eligible', 'Eligible'),
          ...inputTaxColumns('ineligible', 'Ineligible'),
        ],
        rows: report.periods.map((p) => ({ gstin: p.gstin ?? 'No registration on document', taxPeriod: p.taxPeriod, documentCount: p.documentCount, taxable: p.taxable, ...inputTaxCells('eligible', p.eligible), ...inputTaxCells('ineligible', p.ineligible) })),
        totals: { taxable: report.totals.taxable, ...inputTaxCells('eligible', report.totals.eligible), ...inputTaxCells('ineligible', report.totals.ineligible) },
      },
      {
        title: 'Documents',
        columns: [
          { key: 'ledgerDate', label: 'Date', kind: 'date' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'number', label: 'Number', kind: 'text' },
          { key: 'supplierName', label: 'Supplier', kind: 'text' },
          { key: 'supplierGstin', label: 'Supplier GSTIN', kind: 'text' },
          { key: 'taxable', label: 'Taxable', kind: 'money' },
          { key: 'eligibleTotal', label: 'Eligible', kind: 'money' },
          { key: 'ineligibleTotal', label: 'Ineligible', kind: 'money' },
        ],
        rows: report.documents.map((r) => ({
          ledgerDate: r.ledgerDate, type: GST_OUTPUT_TYPE_LABELS[r.documentType] ?? r.documentType, number: r.number, supplierName: r.supplierName, supplierGstin: r.supplierGstin,
          taxable: r.taxable, eligibleTotal: r.eligible.total, ineligibleTotal: r.ineligible.total,
        })),
        totals: { taxable: report.totals.taxable, eligibleTotal: report.totals.eligible.total, ineligibleTotal: report.totals.ineligible.total },
      },
      {
        title: 'Pending approval (not claimable yet)',
        columns: [
          { key: 'documentDate', label: 'Date', kind: 'date' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'number', label: 'Number', kind: 'text' },
          { key: 'supplierName', label: 'Supplier', kind: 'text' },
          { key: 'taxable', label: 'Taxable', kind: 'money' },
          { key: 'eligibleTotal', label: 'GST if approved', kind: 'money' },
        ],
        rows: report.pending.map((r) => ({ documentDate: r.documentDate, type: GST_OUTPUT_TYPE_LABELS[r.documentType] ?? r.documentType, number: r.number, supplierName: r.supplierName, taxable: r.taxable, eligibleTotal: r.eligible.total })),
        totals: { taxable: report.pendingTotals.taxable, eligibleTotal: report.pendingTotals.eligible.total },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function gstNetDocument(report: GstNetReport): ReportDocument {
  const netColumns = [
    { key: 'output', label: 'Output GST', kind: 'money' as const },
    { key: 'eligibleInput', label: 'Eligible input GST', kind: 'money' as const },
    { key: 'adjustments', label: 'Adjustments', kind: 'money' as const },
    { key: 'net', label: 'Net', kind: 'money' as const },
  ];
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By component',
        columns: [{ key: 'label', label: 'Component', kind: 'text' }, ...netColumns],
        rows: report.components.map((c) => ({ label: c.label, output: c.output, eligibleInput: c.eligibleInput, adjustments: c.adjustments, net: c.net })),
        totals: { output: report.totals.output, eligibleInput: report.totals.eligibleInput, adjustments: report.totals.adjustments, net: report.totals.net },
      },
      {
        title: 'By tax period',
        columns: [{ key: 'taxPeriod', label: 'Tax period', kind: 'text' }, ...netColumns],
        rows: report.periods.map((p) => ({ ...p })),
        totals: { output: report.totals.output, eligibleInput: report.totals.eligibleInput, adjustments: report.totals.adjustments, net: report.totals.net },
      },
      {
        title: 'Adjustments',
        columns: [
          { key: 'accountingDate', label: 'Date', kind: 'date' },
          { key: 'sourceType', label: 'Posted by', kind: 'text' },
          { key: 'description', label: 'Description', kind: 'text' },
          { key: 'ledgerAccountName', label: 'Ledger account', kind: 'text' },
          { key: 'amount', label: 'Amount', kind: 'money' },
        ],
        rows: report.adjustments.map((a) => ({ accountingDate: a.accountingDate, sourceType: a.sourceType, description: a.description, ledgerAccountName: a.ledgerAccountName, amount: a.amount })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function gstRegisterDocument(report: GstRegisterReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Totals by document type (void documents excluded)',
        columns: [
          { key: 'type', label: 'Document type', kind: 'text' },
          { key: 'documentCount', label: 'Documents', kind: 'number' },
          { key: 'lineCount', label: 'Lines', kind: 'number' },
          ...taxColumns,
        ],
        rows: report.totals.map((t) => ({ type: GST_OUTPUT_TYPE_LABELS[t.documentType] ?? t.documentType, documentCount: t.documentCount, lineCount: t.lineCount, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total })),
      },
      {
        title: 'Tax lines',
        columns: [
          { key: 'direction', label: 'Direction', kind: 'text' },
          { key: 'documentDate', label: 'Date', kind: 'date' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'number', label: 'Number', kind: 'text' },
          { key: 'status', label: 'Status', kind: 'text' },
          { key: 'gstin', label: 'GSTIN', kind: 'text' },
          { key: 'counterpartyName', label: 'Counterparty', kind: 'text' },
          { key: 'counterpartyGstin', label: 'Counterparty GSTIN', kind: 'text' },
          { key: 'placeOfSupply', label: 'Place of supply', kind: 'text' },
          { key: 'hsnSac', label: 'HSN/SAC', kind: 'text' },
          { key: 'ratePercent', label: 'Rate %', kind: 'text' },
          { key: 'taxable', label: 'Taxable', kind: 'money' },
          { key: 'cgst', label: 'CGST', kind: 'money' },
          { key: 'sgst', label: 'SGST', kind: 'money' },
          { key: 'igst', label: 'IGST', kind: 'money' },
          { key: 'lineTotal', label: 'Line total', kind: 'money' },
          { key: 'itc', label: 'ITC', kind: 'text' },
        ],
        rows: report.lines.map((l) => ({
          direction: l.direction === 'OUTWARD' ? 'Outward' : 'Inward', documentDate: l.documentDate, type: GST_OUTPUT_TYPE_LABELS[l.documentType] ?? l.documentType, number: l.number,
          status: l.status === 'VOID' ? 'Void' : 'Finalized', gstin: l.gstin, counterpartyName: l.counterpartyName, counterpartyGstin: l.counterpartyGstin, placeOfSupply: l.placeOfSupply,
          hsnSac: l.hsnSac, ratePercent: l.ratePercent, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: l.igst, lineTotal: l.lineTotal,
          itc: l.itcEligible === null ? '' : l.itcEligible ? 'Eligible' : 'Ineligible',
        })),
      },
    ],
  };
}

const TDS_TYPE_LABELS: Record<TaxDeductionType, string> = { TDS: 'TDS', CGST_TDS: 'CGST-TDS', SGST_TDS: 'SGST-TDS', IGST_TDS: 'IGST-TDS' };
const TDS_LIFECYCLE_LABELS: Record<TdsDeductionLifecycle, string> = {
  RECORDED: 'Recorded',
  CERTIFICATE_PENDING: 'Certificate pending',
  CERTIFICATE_RECEIVED: 'Certificate received',
  RECONCILED: 'Reconciled',
};

const tdsRowColumns = [
  { key: 'receiptDate', label: 'Receipt date', kind: 'date' as const },
  { key: 'type', label: 'Type', kind: 'text' as const },
  { key: 'clientName', label: 'Client', kind: 'text' as const },
  { key: 'projectName', label: 'Project', kind: 'text' as const },
  { key: 'invoiceNumber', label: 'Invoice', kind: 'text' as const },
  { key: 'amount', label: 'Deducted', kind: 'money' as const },
  { key: 'certificateMatched', label: 'Certificates', kind: 'money' as const },
  { key: 'statementMatched', label: '26AS/statement', kind: 'money' as const },
  { key: 'references', label: 'References', kind: 'text' as const },
  { key: 'periodEnd', label: 'Period end', kind: 'date' as const },
  { key: 'status', label: 'Status', kind: 'text' as const },
];
const tdsRowCells = (r: TdsInwardRow) => ({
  receiptDate: r.receiptDate, type: TDS_TYPE_LABELS[r.deductionType], clientName: r.clientName, projectName: r.projectName, invoiceNumber: r.invoiceNumber,
  amount: r.amount, certificateMatched: r.certificateMatched, statementMatched: r.statementMatched,
  references: [...r.certificateReferences, ...r.statementReferences].join(', '), periodEnd: r.periodEnd,
  status: `${TDS_LIFECYCLE_LABELS[r.lifecycle]}${r.partiallyMatched ? ' (partial)' : ''}`,
});

export function tdsInwardDocument(report: TdsInwardReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Summary by type',
        columns: [
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'count', label: 'Deductions', kind: 'number' },
          { key: 'amount', label: 'Deducted', kind: 'money' },
          { key: 'certificateMatched', label: 'Certificates', kind: 'money' },
          { key: 'statementMatched', label: '26AS/statement', kind: 'money' },
          { key: 'recorded', label: 'Recorded', kind: 'money' },
          { key: 'pending', label: 'Certificate pending', kind: 'money' },
          { key: 'received', label: 'Certificate received', kind: 'money' },
          { key: 'reconciled', label: 'Reconciled', kind: 'money' },
        ],
        rows: report.summary.map((s) => ({
          type: TDS_TYPE_LABELS[s.deductionType], count: s.count, amount: s.amount, certificateMatched: s.certificateMatched, statementMatched: s.statementMatched,
          recorded: s.byLifecycle.RECORDED.amount, pending: s.byLifecycle.CERTIFICATE_PENDING.amount, received: s.byLifecycle.CERTIFICATE_RECEIVED.amount, reconciled: s.byLifecycle.RECONCILED.amount,
        })),
      },
      { title: 'Deductions', columns: tdsRowColumns, rows: report.rows.map(tdsRowCells) },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function tdsReconciliationDocument(report: TdsReconciliationReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: [...scopeDetails(report.scope, report.reconciliation), `Exceptions: ${report.totals.exceptionCount}`],
    sections: [
      {
        title: 'Deducted against credits, by type',
        columns: [
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'deducted', label: 'Deducted on receipts', kind: 'money' },
          { key: 'certificateCredits', label: 'Certificate credits', kind: 'money' },
          { key: 'statementCredits', label: '26AS/statement credits', kind: 'money' },
          { key: 'statementDifference', label: 'Not yet in statement', kind: 'money' },
        ],
        rows: report.summary.map((s) => ({ type: TDS_TYPE_LABELS[s.deductionType], deducted: s.deducted, certificateCredits: s.certificateCredits, statementCredits: s.statementCredits, statementDifference: s.statementDifference })),
      },
      { title: 'Certificates overdue', columns: tdsRowColumns, rows: report.pendingCertificates.map(tdsRowCells) },
      { title: 'Partially matched', columns: tdsRowColumns, rows: report.partialMatches.map(tdsRowCells) },
      {
        title: 'Credits no deduction explains',
        columns: [
          { key: 'creditDate', label: 'Credit date', kind: 'date' },
          { key: 'source', label: 'Source', kind: 'text' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'referenceNumber', label: 'Reference', kind: 'text' },
          { key: 'partyName', label: 'Client', kind: 'text' },
          { key: 'amount', label: 'Amount', kind: 'money' },
          { key: 'matchedAmount', label: 'Matched', kind: 'money' },
          { key: 'unmatchedAmount', label: 'Unmatched', kind: 'money' },
        ],
        rows: report.unmatchedCredits.map((c) => ({ creditDate: c.creditDate, source: c.source === 'CERTIFICATE' ? 'Certificate' : '26AS/statement', type: TDS_TYPE_LABELS[c.deductionType], referenceNumber: c.referenceNumber, partyName: c.partyName, amount: c.amount, matchedAmount: c.matchedAmount, unmatchedAmount: c.unmatchedAmount })),
      },
      {
        title: 'Matches on reversed receipts',
        columns: [
          { key: 'referenceNumber', label: 'Certificate', kind: 'text' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'amount', label: 'Matched', kind: 'money' },
        ],
        rows: report.reversedReceiptMatches.map((m) => ({ referenceNumber: m.referenceNumber, type: TDS_TYPE_LABELS[m.deductionType], amount: m.amount })),
      },
    ],
  };
}

const OUTWARD_SOURCE_LABELS: Record<string, string> = {
  VENDOR_PAYMENT_DEDUCTION: 'Vendor payment',
  DIRECT_EXPENSE: 'Direct expense',
  INTRODUCER_PAYMENT: 'Introducer payment',
  SALARY_PAYMENT_LINE: 'Salary payment',
};

export function tdsOutwardDocument(report: TdsOutwardReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Summary by type',
        columns: [
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'count', label: 'Items', kind: 'number' },
          { key: 'deducted', label: 'Withheld', kind: 'money' },
          { key: 'deposited', label: 'Deposited', kind: 'money' },
          { key: 'payable', label: 'Payable', kind: 'money' },
          { key: 'overdueCount', label: 'Overdue items', kind: 'number' },
          { key: 'overdueAmount', label: 'Overdue', kind: 'money' },
        ],
        rows: report.summary.map((s) => ({ type: TDS_TYPE_LABELS[s.deductionType], count: s.count, deducted: s.deducted, deposited: s.deposited, payable: s.payable, overdueCount: s.overdueCount, overdueAmount: s.overdueAmount })),
      },
      {
        title: 'Withheld amounts',
        columns: [
          { key: 'deductionDate', label: 'Date', kind: 'date' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'source', label: 'Source', kind: 'text' },
          { key: 'documentLabel', label: 'Document', kind: 'text' },
          { key: 'deducteeName', label: 'Deductee', kind: 'text' },
          { key: 'amount', label: 'Withheld', kind: 'money' },
          { key: 'deposited', label: 'Deposited', kind: 'money' },
          { key: 'remaining', label: 'Payable', kind: 'money' },
          { key: 'challans', label: 'Challans', kind: 'text' },
          { key: 'dueDate', label: 'Due', kind: 'date' },
          { key: 'status', label: 'Status', kind: 'text' },
        ],
        rows: report.rows.map((r) => ({
          deductionDate: r.deductionDate, type: TDS_TYPE_LABELS[r.deductionType], source: OUTWARD_SOURCE_LABELS[r.sourceKind] ?? r.sourceKind, documentLabel: r.documentLabel, deducteeName: r.deducteeName,
          amount: r.amount, deposited: r.deposited, remaining: r.remaining, challans: r.challanNumbers.join(', '), dueDate: r.dueDate,
          status: r.remaining === '0.00' ? 'Deposited' : r.overdue ? 'Overdue' : 'Payable',
        })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function cashFlowDocument(report: CashFlowReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By bank account',
        columns: [{ key: 'bankAccountName', label: 'Bank account', kind: 'text' }, money('opening', 'Opening'), money('inflow', 'Money in'), money('outflow', 'Money out'), money('closing', 'Closing')],
        rows: report.accounts.map((a) => ({ bankAccountName: a.bankAccountName, opening: a.opening, inflow: a.inflow, outflow: a.outflow, closing: a.closing })),
        totals: { ...report.totals },
      },
      {
        title: 'By month',
        columns: [
          { key: 'bankAccountName', label: 'Bank account', kind: 'text' },
          { key: 'month', label: 'Month', kind: 'text' },
          money('opening', 'Opening'),
          money('inflow', 'Money in'),
          money('outflow', 'Money out'),
          money('closing', 'Closing'),
          money('matchedInflow', 'In matched to statement'),
          money('matchedOutflow', 'Out matched to statement'),
          { key: 'reconciliationStatus', label: 'Reconciliation', kind: 'text' },
        ],
        rows: report.months.map((m) => ({ ...m, reconciliationStatus: m.reconciliationStatus.replace('_', ' ').toLowerCase() })),
      },
      {
        title: 'Net movement by kind',
        columns: [{ key: 'label', label: 'Kind', kind: 'text' }, money('amount', 'Net (in +, out −)')],
        rows: report.byCategory.map((c) => ({ label: c.label, amount: c.amount })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function payablesAgingDocument(report: PayablesAgingReport): ReportDocument {
  const buckets = report.buckets.filter((b) => b.bucket !== 'NOT_DUE');
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Summary',
        columns: [
          { key: 'bucket', label: 'Age', kind: 'text' },
          { key: 'count', label: 'Documents', kind: 'number' },
          { key: 'amount', label: 'Outstanding', kind: 'money' },
        ],
        rows: buckets.map((b) => ({ bucket: AGING_BUCKET_LABELS[b.bucket], count: b.count, amount: b.amount })),
        totals: { amount: report.total },
      },
      {
        title: 'By vendor',
        columns: [
          { key: 'vendorName', label: 'Vendor', kind: 'text' },
          ...buckets.map((b) => ({ key: b.bucket, label: AGING_BUCKET_LABELS[b.bucket], kind: 'money' as const })),
          { key: 'outstanding', label: 'Outstanding', kind: 'money' },
        ],
        rows: report.vendors.map((v) => ({ vendorName: v.vendorName, ...v.byBucket, outstanding: v.outstanding })),
        totals: { outstanding: report.total },
      },
      {
        title: 'Documents',
        columns: [
          { key: 'number', label: 'Document', kind: 'text' },
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'vendorName', label: 'Vendor', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'documentDate', label: 'Date', kind: 'date' },
          { key: 'totalAmount', label: 'Total', kind: 'money' },
          { key: 'settledAmount', label: 'Settled', kind: 'money' },
          { key: 'outstandingAmount', label: 'Outstanding', kind: 'money' },
          { key: 'approvedForPayment', label: 'Approved for payment', kind: 'money' },
          { key: 'ageDays', label: 'Age (days)', kind: 'number' },
          { key: 'bucket', label: 'Age', kind: 'text' },
        ],
        rows: report.rows.map((r) => ({ ...r, type: r.documentType === 'VENDOR_BILL' ? 'Vendor bill' : 'Stock receipt', projectName: r.projectName ?? '—', bucket: AGING_BUCKET_LABELS[r.bucket] })),
        totals: { outstandingAmount: report.total, approvedForPayment: report.approvedForPaymentTotal },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const deductionColumns = [
  { key: 'TDS', label: 'TDS', kind: 'money' as const },
  { key: 'CGST_TDS', label: 'CGST-TDS', kind: 'money' as const },
  { key: 'SGST_TDS', label: 'SGST-TDS', kind: 'money' as const },
  { key: 'IGST_TDS', label: 'IGST-TDS', kind: 'money' as const },
];

export function vendorPaymentsDocument(report: VendorPaymentReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Payments',
        columns: [
          { key: 'ledgerDate', label: 'Posted', kind: 'date' },
          { key: 'entry', label: 'Entry', kind: 'text' },
          { key: 'vendors', label: 'Vendors', kind: 'text' },
          { key: 'bankAccountName', label: 'Bank account', kind: 'text' },
          { key: 'utrReference', label: 'UTR', kind: 'text' },
          { key: 'cashPaid', label: 'Cash paid', kind: 'money' },
          ...deductionColumns,
          { key: 'settledAmount', label: 'Settled', kind: 'money' },
        ],
        rows: report.rows.map((r) => ({ ledgerDate: r.ledgerDate, entry: r.entryType === 'PAYMENT' ? 'Payment' : 'Reversal', vendors: r.vendorNames.join(', '), bankAccountName: r.bankAccountName, utrReference: r.utrReference ?? '—', cashPaid: r.cashPaid, ...r.deductions, settledAmount: r.settledAmount })),
        totals: { cashPaid: report.totals.cashPaid, ...report.totals.deductions, settledAmount: report.totals.settledAmount },
      },
      {
        title: 'Bills settled',
        columns: [
          { key: 'ledgerDate', label: 'Posted', kind: 'date' },
          { key: 'vendorBillNumber', label: 'Vendor bill', kind: 'text' },
          { key: 'vendorName', label: 'Vendor', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'requestedAmount', label: 'Requested', kind: 'money' },
          { key: 'cashPaid', label: 'Cash paid', kind: 'money' },
          ...deductionColumns,
          { key: 'settledAmount', label: 'Settled', kind: 'money' },
        ],
        rows: report.rows.flatMap((r) => r.allocations.map((a) => ({ ledgerDate: r.ledgerDate, vendorBillNumber: a.vendorBillNumber, vendorName: a.vendorName, projectName: a.projectName, requestedAmount: a.requestedAmount, cashPaid: a.cashPaid, ...a.deductions, settledAmount: a.settledAmount }))),
      },
      {
        title: 'By vendor',
        columns: [
          { key: 'vendorName', label: 'Vendor', kind: 'text' },
          { key: 'cashPaid', label: 'Cash paid', kind: 'money' },
          { key: 'deducted', label: 'Tax withheld', kind: 'money' },
          { key: 'settledAmount', label: 'Settled', kind: 'money' },
        ],
        rows: report.byVendor.map((v) => ({ ...v })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const EXPENSE_SOURCE_LABELS: Record<string, string> = {
  VENDOR_BILL_LINE: 'Vendor bill',
  VENDOR_BILL_VOID: 'Vendor bill void',
  DIRECT_EXPENSE: 'Direct expense',
  DIRECT_EXPENSE_REVERSAL: 'Direct expense reversal',
  EXPENSE_CLAIM: 'Employee claim',
};

export function expensesDocument(report: ExpenseReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By category',
        columns: [
          { key: 'category', label: 'Category', kind: 'text' },
          { key: 'grossAmount', label: 'Gross', kind: 'money' },
          { key: 'recognizedAmount', label: 'Recognized', kind: 'money' },
        ],
        rows: report.byCategory.map((c) => ({ ...c })),
        totals: { grossAmount: report.totals.grossAmount, recognizedAmount: report.totals.recognizedAmount },
      },
      {
        title: 'By project',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'recognizedAmount', label: 'Recognized', kind: 'money' },
        ],
        rows: report.byProject.map((p) => ({ projectName: p.projectName, recognizedAmount: p.recognizedAmount })),
        totals: { recognizedAmount: report.totals.recognizedAmount },
      },
      {
        title: 'Entries',
        columns: [
          { key: 'ledgerDate', label: 'Posted', kind: 'date' },
          { key: 'source', label: 'Source', kind: 'text' },
          { key: 'documentLabel', label: 'Document', kind: 'text' },
          { key: 'category', label: 'Category', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'counterparty', label: 'Paid to', kind: 'text' },
          { key: 'grossAmount', label: 'Gross', kind: 'money' },
          { key: 'eligibleGst', label: 'Recoverable GST', kind: 'money' },
          { key: 'recognizedAmount', label: 'Recognized', kind: 'money' },
        ],
        rows: report.rows.map((r) => ({ ...r, source: EXPENSE_SOURCE_LABELS[r.sourceType] ?? r.sourceType, projectName: r.projectName ?? '—', counterparty: r.counterparty ?? '—' })),
        totals: { ...report.totals },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function reimbursementsDocument(report: ReimbursementReport): ReportDocument {
  const t = report.totals;
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Summary',
        columns: [
          { key: 'label', label: 'Figure', kind: 'text' },
          { key: 'count', label: 'Claims', kind: 'number' },
          { key: 'amount', label: 'Amount', kind: 'money' },
        ],
        rows: [
          { label: 'Approved in the period', ...t.approvedInPeriod },
          { label: 'Reimbursed in the period', ...t.reimbursedInPeriod },
          { label: 'Awaiting reimbursement', ...t.awaitingReimbursement },
          { label: 'Awaiting approval', ...t.awaitingApproval },
          { label: 'Rejected', ...t.rejected },
        ],
      },
      {
        title: 'By employee',
        columns: [
          { key: 'employeeName', label: 'Employee', kind: 'text' },
          { key: 'approved', label: 'Approved', kind: 'money' },
          { key: 'reimbursed', label: 'Reimbursed', kind: 'money' },
          { key: 'awaitingReimbursement', label: 'Awaiting reimbursement', kind: 'money' },
        ],
        rows: report.byEmployee.map((e) => ({ ...e })),
      },
      {
        title: 'Claims',
        columns: [
          { key: 'expenseDate', label: 'Expense date', kind: 'date' },
          { key: 'employeeName', label: 'Employee', kind: 'text' },
          { key: 'title', label: 'Claim', kind: 'text' },
          { key: 'category', label: 'Category', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'amount', label: 'Amount', kind: 'money' },
          { key: 'gstCreditAmount', label: 'GST credit', kind: 'money' },
          { key: 'status', label: 'Status', kind: 'text' },
          { key: 'approvedOn', label: 'Approved', kind: 'date' },
          { key: 'reimbursedOn', label: 'Reimbursed', kind: 'date' },
        ],
        rows: report.rows.map((r) => ({ ...r, projectName: r.projectName ?? '—', status: r.status.charAt(0) + r.status.slice(1).toLowerCase(), approvedOn: r.approvedOn ?? '', reimbursedOn: r.reimbursedOn ?? '' })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function employeeAdvancesDocument(report: EmployeeAdvanceReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By employee',
        columns: [
          { key: 'employeeName', label: 'Employee', kind: 'text' },
          money('opening', 'Opening'),
          money('advances', 'Advances issued'),
          money('claimsAdjusted', 'Claims adjusted'),
          money('reimbursements', 'Reimbursements paid'),
          money('other', 'Other'),
          money('closing', 'Closing'),
        ],
        rows: report.rows.map((r) => ({ ...r })),
        totals: { ...report.totals },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const EMD_STATUS_LABELS: Record<string, string> = { LODGED: 'Lodged', OVERDUE: 'Overdue', RETURNED: 'Returned' };

export function emdSdRecoveryDocument(report: EmdSdRecoveryReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By category',
        columns: [{ key: 'category', label: 'Category', kind: 'text' }, { key: 'count', label: 'Instruments', kind: 'number' }, money('cashOutstanding', 'Cash lodged'), money('guaranteeOutstanding', 'Guarantees lodged'), money('returned', 'Returned')],
        rows: report.byCategory.map((c) => ({ ...c, category: c.category === 'UNCLASSIFIED' ? 'Unclassified' : c.category })),
        totals: { cashOutstanding: report.totals.cashOutstanding, guaranteeOutstanding: report.totals.guaranteeOutstanding, returned: report.totals.returned },
      },
      {
        title: 'Instruments',
        columns: [
          { key: 'category', label: 'Category', kind: 'text' },
          { key: 'purposeName', label: 'Purpose', kind: 'text' },
          { key: 'typeName', label: 'Instrument', kind: 'text' },
          { key: 'exposure', label: 'Exposure', kind: 'text' },
          { key: 'against', label: 'Project', kind: 'text' },
          { key: 'referenceNo', label: 'Reference', kind: 'text' },
          { key: 'submittedOn', label: 'Submitted', kind: 'date' },
          { key: 'returnDueOn', label: 'Return due', kind: 'date' },
          { key: 'returnedOn', label: 'Returned', kind: 'date' },
          money('amount', 'Amount'),
          money('outstandingAmount', 'Still lodged'),
          { key: 'status', label: 'Status', kind: 'text' },
          { key: 'daysOverdue', label: 'Days overdue', kind: 'number' },
        ],
        rows: report.rows.map((r) => ({
          ...r, category: r.category ?? 'Unclassified', exposure: r.exposure === 'CASH' ? 'Cash' : 'Guarantee', against: [r.projectName, r.tenderLabel].filter(Boolean).join(' / '),
          referenceNo: r.referenceNo ?? '', returnedOn: r.returnedOn ?? '', status: EMD_STATUS_LABELS[r.status] ?? r.status, daysOverdue: r.daysOverdue ?? '',
        })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const INTRODUCER_ENTRY_LABELS: Record<string, string> = { ACCRUAL: 'Accrual', ACCRUAL_REVERSAL: 'Accrual reversal', PAYMENT: 'Payment', PAYMENT_REVERSAL: 'Payment reversal' };

export function introducerStatementDocument(report: IntroducerStatementReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: [...scopeDetails(report.scope, report.reconciliation), ...(report.advanceOutstanding !== null ? [`Unallocated advance paid: ${report.advanceOutstanding}`] : [])],
    sections: [
      {
        title: 'By introducer and project',
        columns: [
          { key: 'introducerName', label: 'Introducer', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'basisDescription', label: 'Basis', kind: 'text' },
          money('entitlement', 'Entitlement'),
          money('notYetAccrued', 'Not yet accrued'),
          money('opening', 'Opening'),
          money('accrued', 'Accrued'),
          money('paid', 'Paid'),
          money('closing', 'Closing'),
        ],
        rows: report.accounts.map((a) => ({ introducerName: a.introducerName, projectName: a.projectName, basisDescription: a.basisDescription, entitlement: a.entitlement, notYetAccrued: a.notYetAccrued, opening: a.opening, accrued: a.accrued, paid: a.paid, closing: a.closing })),
        totals: { ...report.totals },
      },
      {
        title: 'Statement',
        columns: [
          { key: 'introducerName', label: 'Introducer', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'ledgerDate', label: 'Date', kind: 'date' },
          { key: 'entry', label: 'Entry', kind: 'text' },
          { key: 'documentNumber', label: 'Document', kind: 'text' },
          { key: 'narrative', label: 'Particulars', kind: 'text' },
          money('accrued', 'Accrued'),
          money('paid', 'Paid'),
          money('balance', 'Balance'),
        ],
        rows: report.accounts.flatMap((a) => a.lines.map((l) => ({ introducerName: a.introducerName, projectName: a.projectName, ...l, entry: INTRODUCER_ENTRY_LABELS[l.entryType] ?? l.entryType, narrative: l.narrative ?? '' }))),
      },
      {
        title: 'Payments',
        columns: [
          { key: 'ledgerDate', label: 'Date', kind: 'date' },
          { key: 'paymentNumber', label: 'Payment', kind: 'text' },
          { key: 'entry', label: 'Entry', kind: 'text' },
          { key: 'introducerName', label: 'Introducer', kind: 'text' },
          { key: 'referenceNumber', label: 'Reference', kind: 'text' },
          money('allocatedAmount', 'Allocated'),
          money('advanceAmount', 'Advance'),
          money('grossAmount', 'Gross'),
          money('tdsAmount', 'TDS'),
          money('netAmount', 'Net paid'),
        ],
        rows: report.payments.map((p) => ({ ...p, entry: p.entryType === 'PAYMENT' ? 'Payment' : 'Reversal', referenceNumber: p.referenceNumber ?? '', advanceAmount: p.advanceAmount ?? '', grossAmount: p.grossAmount ?? '', tdsAmount: p.tdsAmount ?? '', netAmount: p.netAmount ?? '' })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function penaltiesDocument(report: PenaltyReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By category',
        columns: [{ key: 'categoryName', label: 'Category', kind: 'text' }, money('accepted', 'Accepted'), money('disputed', 'Disputed')],
        rows: report.byCategory.map((c) => ({ ...c })),
        totals: { accepted: report.totals.accepted, disputed: report.totals.disputed },
      },
      {
        title: 'Penalties',
        columns: [
          { key: 'ledgerDate', label: 'Posted', kind: 'date' },
          { key: 'entry', label: 'Entry', kind: 'text' },
          { key: 'status', label: 'State', kind: 'text' },
          { key: 'categoryName', label: 'Category', kind: 'text' },
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'narrative', label: 'Reason', kind: 'text' },
          { key: 'ledgerAccountName', label: 'Posted to', kind: 'text' },
          money('amount', 'Amount'),
        ],
        rows: report.rows.map((r) => ({ ...r, entry: r.entryType === 'DEDUCTION' ? 'Deduction' : 'Reversal', status: r.status === 'ACCEPTED' ? 'Accepted' : 'Disputed', categoryName: r.categoryName ?? '', narrative: r.narrative ?? '' })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const HOLD_STATUS_LABELS: Record<string, string> = { OUTSTANDING: 'Outstanding', PARTIALLY_RELEASED: 'Partially released', RELEASED: 'Released' };

export function paymentHoldsDocument(report: PaymentHoldReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Summary',
        columns: [{ key: 'type', label: 'Type', kind: 'text' }, { key: 'count', label: 'Deductions', kind: 'number' }, money('withheld', 'Withheld'), money('released', 'Released'), money('outstanding', 'Still to recover')],
        rows: (['HOLD', 'RETENTION'] as const).map((type) => ({ type: type === 'HOLD' ? 'Hold' : 'Retention', ...report.totals[type] })),
      },
      {
        title: 'Deductions',
        columns: [
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'receiptDate', label: 'Withheld on', kind: 'date' },
          money('amount', 'Withheld'),
          money('releasedAmount', 'Released'),
          money('outstandingAmount', 'Still to recover'),
          { key: 'status', label: 'Status', kind: 'text' },
          { key: 'lastReleasedOn', label: 'Last release', kind: 'date' },
        ],
        rows: report.rows.map((r) => ({ type: r.type === 'HOLD' ? 'Hold' : 'Retention', invoiceNumber: r.invoiceNumber, clientName: r.clientName, projectName: r.projectName, receiptDate: r.receiptDate, amount: r.amount, releasedAmount: r.releasedAmount, outstandingAmount: r.outstandingAmount, status: HOLD_STATUS_LABELS[r.status] ?? r.status, lastReleasedOn: r.lastReleasedOn })),
      },
      {
        title: 'Releases',
        columns: [
          { key: 'type', label: 'Type', kind: 'text' },
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'releasedOn', label: 'Released on', kind: 'date' },
          { key: 'utrReference', label: 'UTR', kind: 'text' },
          money('amount', 'Released'),
        ],
        rows: report.rows.flatMap((r) => r.releases.map((rel) => ({ type: r.type === 'HOLD' ? 'Hold' : 'Retention', invoiceNumber: r.invoiceNumber, releasedOn: rel.releasedOn, utrReference: rel.utrReference ?? '', amount: rel.amount }))),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function pendingInvoicesDocument(report: PendingInvoiceReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Pending invoices',
        columns: [
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'invoiceDate', label: 'Invoice date', kind: 'date' },
          { key: 'dueDate', label: 'Due date', kind: 'date' },
          money('totalAmount', 'Total'),
          money('settledAmount', 'Received'),
          money('noteAdjustmentAmount', 'Notes'),
          money('outstandingAmount', 'Outstanding'),
          { key: 'daysPastDue', label: 'Days past due', kind: 'number' },
          { key: 'bucket', label: 'Age', kind: 'text' },
          { key: 'state', label: 'State', kind: 'text' },
        ],
        rows: report.invoices.map((r) => ({ invoiceNumber: r.invoiceNumber, clientName: r.clientName, projectName: r.projectName, invoiceDate: r.invoiceDate, dueDate: r.dueDate, totalAmount: r.totalAmount, settledAmount: r.settledAmount, noteAdjustmentAmount: r.noteAdjustmentAmount, outstandingAmount: r.outstandingAmount, daysPastDue: r.daysPastDue, bucket: AGING_BUCKET_LABELS[r.bucket], state: r.settlementState === 'UNSETTLED' ? 'Unpaid' : 'Part paid' })),
        totals: { outstandingAmount: report.invoiceTotal },
      },
      {
        title: 'Billing pending (not yet invoiced, before GST)',
        columns: [
          { key: 'projectName', label: 'Project', kind: 'text' },
          { key: 'clientName', label: 'Client', kind: 'text' },
          { key: 'source', label: 'Milestone', kind: 'text' },
          { key: 'dueDate', label: 'Due', kind: 'date' },
          money('amount', 'Amount'),
          { key: 'status', label: 'Alert', kind: 'text' },
          { key: 'draft', label: 'Draft invoice', kind: 'text' },
        ],
        rows: report.billingPending.map((b) => ({ projectName: b.projectName, clientName: b.clientName, source: b.sourceLabel, dueDate: b.dueDate, amount: b.amount, status: b.alertStatus === 'OPEN' ? 'Open' : `Snoozed until ${b.snoozedUntil ?? ''}`, draft: b.draftInvoiceId ? 'Yes' : 'No' })),
        totals: { amount: report.billingPendingTotal },
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const RECEIPT_DEDUCTION_COLUMNS: Array<{ key: ReceiptDeductionType; label: string }> = [
  { key: 'TDS', label: 'TDS' },
  { key: 'CGST_TDS', label: 'CGST-TDS' },
  { key: 'SGST_TDS', label: 'SGST-TDS' },
  { key: 'IGST_TDS', label: 'IGST-TDS' },
  { key: 'HOLD', label: 'Hold' },
  { key: 'RETENTION', label: 'Retention' },
  { key: 'ACCEPTED_PENALTY', label: 'Accepted penalty' },
  { key: 'DISPUTED_PENALTY', label: 'Disputed penalty' },
  { key: 'OTHER', label: 'Other' },
];

export function clientPaymentsDocument(report: ClientPaymentReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  const deductionColumns = RECEIPT_DEDUCTION_COLUMNS.map((c) => money(c.key, c.label));
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'Receipts',
        columns: [
          { key: 'ledgerDate', label: 'Posted', kind: 'date' },
          { key: 'entry', label: 'Entry', kind: 'text' },
          { key: 'utrReference', label: 'UTR', kind: 'text' },
          { key: 'clients', label: 'Client', kind: 'text' },
          { key: 'paymentModeName', label: 'Mode', kind: 'text' },
          money('actualAmount', 'Cash received'),
          money('invoiceSettled', 'Invoice settled'),
          ...deductionColumns,
          money('unallocatedCash', 'Unallocated'),
        ],
        rows: report.rows.map((r) => ({ ledgerDate: r.ledgerDate, entry: r.entryType === 'RECEIPT' ? 'Receipt' : 'Reversal', utrReference: r.utrReference, clients: r.clientNames.join(', '), paymentModeName: r.paymentModeName, actualAmount: r.actualAmount, invoiceSettled: r.invoiceSettled, ...r.deductions, unallocatedCash: r.unallocatedCash })),
        totals: { actualAmount: report.totals.actualAmount, invoiceSettled: report.totals.invoiceSettled, ...report.totals.deductions, unallocatedCash: report.totals.unallocatedCash },
      },
      {
        title: 'Invoices settled',
        columns: [
          { key: 'ledgerDate', label: 'Posted', kind: 'date' },
          { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
          { key: 'projectName', label: 'Project', kind: 'text' },
          money('cashAllocated', 'Cash'),
          ...deductionColumns,
          money('settledAmount', 'Settled'),
        ],
        rows: report.rows.flatMap((r) => r.allocations.map((a) => ({ ledgerDate: r.ledgerDate, invoiceNumber: a.invoiceNumber, projectName: a.projectName, cashAllocated: a.cashAllocated, ...a.deductions, settledAmount: a.settledAmount }))),
      },
      {
        title: 'By client',
        columns: [{ key: 'clientName', label: 'Client', kind: 'text' }, money('actualAmount', 'Cash received'), money('deductionTotal', 'Deductions'), money('invoiceSettled', 'Invoice settled')],
        rows: report.byClient.map((c) => ({ ...c })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

const ALLOCATION_STATE_LABELS: Record<string, string> = { SUBMITTED: 'Submitted', DRAFT: 'Draft', NOT_STARTED: 'Not started' };

export function manpowerUtilizationDocument(report: ManpowerUtilizationReport): ReportDocument {
  const money = (key: string, label: string) => ({ key, label, kind: 'money' as const });
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: scopeDetails(report.scope, report.reconciliation),
    sections: [
      {
        title: 'By month',
        columns: [
          { key: 'month', label: 'Month', kind: 'date' },
          { key: 'employees', label: 'Employees', kind: 'number' },
          { key: 'submitted', label: 'Submitted', kind: 'number' },
          { key: 'draft', label: 'Draft', kind: 'number' },
          { key: 'notStarted', label: 'Not started', kind: 'number' },
          money('grossSalary', 'Gross salary'),
          money('projectCost', 'Project cost'),
          money('nonProjectCost', 'Non-project cost'),
          money('unallocatedSalary', 'Not yet attributed'),
        ],
        rows: report.byMonth.map((m) => ({ ...m })),
        totals: { ...report.totals },
      },
      {
        title: 'Employees',
        columns: [
          { key: 'month', label: 'Month', kind: 'date' },
          { key: 'employeeCode', label: 'Code', kind: 'text' },
          { key: 'employeeName', label: 'Employee', kind: 'text' },
          { key: 'departmentName', label: 'Department', kind: 'text' },
          { key: 'state', label: 'State', kind: 'text' },
          { key: 'projectPercentage', label: 'Project %', kind: 'text' },
          { key: 'nonProjectPercentage', label: 'Non-project %', kind: 'text' },
          { key: 'totalPercentage', label: 'Total %', kind: 'text' },
          { key: 'variancePercentage', label: 'Variance vs 100%', kind: 'text' },
          money('grossSalary', 'Gross'),
          money('projectCost', 'Project cost'),
          money('nonProjectCost', 'Non-project cost'),
          { key: 'shares', label: 'Allocation', kind: 'text' },
        ],
        rows: report.rows.map((r) => ({ month: r.month, employeeCode: r.employeeCode, employeeName: r.employeeName, departmentName: r.departmentName, state: ALLOCATION_STATE_LABELS[r.state] ?? r.state, projectPercentage: r.projectPercentage, nonProjectPercentage: r.nonProjectPercentage, totalPercentage: r.totalPercentage, variancePercentage: r.variancePercentage, grossSalary: r.grossSalary, projectCost: r.projectCost, nonProjectCost: r.nonProjectCost, shares: r.shares.map((sh) => `${sh.targetName} ${sh.percentage}%`).join('; ') })),
      },
      ...reconciliationSection(report.reconciliation),
    ],
  };
}

export function auditActivityDocument(report: AuditActivityReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: [...scopeDetails(report.scope, report.reconciliation), `Events: ${report.totals.events} · sensitive: ${report.totals.sensitive}`],
    sections: [
      {
        title: 'By control group',
        columns: [{ key: 'label', label: 'Group', kind: 'text' }, { key: 'count', label: 'Events', kind: 'number' }],
        rows: report.byGroup.map((g) => ({ label: g.label, count: g.count })),
      },
      {
        title: 'By user',
        columns: [{ key: 'actorEmail', label: 'User', kind: 'text' }, { key: 'events', label: 'Events', kind: 'number' }, { key: 'sensitive', label: 'Sensitive', kind: 'number' }],
        rows: report.byActor.map((a) => ({ ...a })),
      },
      {
        title: 'Repeated sign-in failures',
        columns: [{ key: 'email', label: 'User', kind: 'text' }, { key: 'failures', label: 'Failures', kind: 'number' }, { key: 'lastAt', label: 'Last failure (UTC)', kind: 'text' }],
        rows: report.repeatedSignInFailures.map((f) => ({ email: f.email ?? f.userId, failures: f.failures, lastAt: f.lastAt })),
      },
      {
        title: 'Sensitive events (newest first)',
        columns: [
          { key: 'occurredAt', label: 'When (UTC)', kind: 'text' },
          { key: 'group', label: 'Group', kind: 'text' },
          { key: 'action', label: 'Action', kind: 'text' },
          { key: 'entityType', label: 'Record', kind: 'text' },
          { key: 'actorEmail', label: 'User', kind: 'text' },
          { key: 'reason', label: 'Reason', kind: 'text' },
        ],
        rows: report.sensitiveEvents.map((e) => ({ occurredAt: e.occurredAt, group: e.group, action: e.action, entityType: e.entityType, actorEmail: e.actorEmail, reason: e.reason })),
      },
    ],
  };
}

export function exceptionsDocument(report: ExceptionsReport): ReportDocument {
  return {
    title: report.catalog.title,
    subtitle: report.catalog.basisLabel,
    details: [...scopeDetails(report.scope, report.reconciliation), `Open: ${report.openCount}`],
    sections: [
      {
        title: 'Ledger checks',
        columns: [
          { key: 'title', label: 'Report', kind: 'text' },
          { key: 'label', label: 'Figure', kind: 'text' },
          { key: 'reportAmount', label: 'Report total', kind: 'money' },
          { key: 'ledgerAmount', label: 'Ledger', kind: 'money' },
          { key: 'difference', label: 'Difference', kind: 'money' },
          { key: 'status', label: 'Status', kind: 'text' },
        ],
        rows: report.ledgerChecks.flatMap((c) => c.lines.map((l) => ({ title: c.title, label: l.label, reportAmount: l.reportAmount, ledgerAmount: l.ledgerAmount, difference: l.difference, status: l.reconciled ? 'Agrees' : 'Differs' }))),
      },
      {
        title: 'Open items',
        columns: [
          { key: 'area', label: 'Area', kind: 'text' },
          { key: 'label', label: 'Item', kind: 'text' },
          { key: 'count', label: 'Count', kind: 'number' },
          { key: 'amount', label: 'Amount', kind: 'money' },
          { key: 'oldestDate', label: 'Oldest', kind: 'date' },
        ],
        rows: report.items.map((i) => ({ area: i.area, label: i.label, count: i.count, amount: i.amount, oldestDate: i.oldestDate })),
      },
    ],
  };
}
