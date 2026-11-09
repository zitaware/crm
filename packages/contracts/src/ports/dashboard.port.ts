/**
 * The main Dashboard (Phase 8.9a, ADR-119) — docs/04 §1 `dashboard.getOverview`.
 * Every card is one figure of one report, computed by that report for the
 * same filters, and links to it; a card appears only when the viewer may
 * open its report. No figure is computed for the dashboard alone, except
 * that the financial summary (ADR-159) groups Cost to Company's project rows
 * by project type and states each share as a percentage.
 */

import type { AgingBucketTotal, ReportBasis, ReportKey } from './report.port';

export const DASHBOARD_READ_PERMISSION = 'dashboard.read';

export interface DashboardFilters {
  legalEntityId: string | undefined;
  /** Start of the business period, for period cards; balances are as of `asOfDate`. */
  dateFrom: string;
  asOfDate: string;
}

export type DashboardCardKey =
  | 'INVOICE_OUTSTANDING'
  | 'HOLD_RETENTION'
  | 'PAST_DUE'
  | 'BILLING_PENDING'
  | 'INCOME'
  | 'CONTRIBUTION'
  | 'BANK_BALANCE'
  | 'GST_NET'
  | 'TDS_PAYABLE'
  | 'TDS_CERTIFICATES_PENDING'
  | 'OWED_TO_VENDORS'
  | 'EXPENSES'
  | 'EMD_SD_CASH';

export type DashboardSection = 'RECEIVABLES' | 'PERFORMANCE' | 'CASH_AND_TAX' | 'PAYABLES_AND_OPERATIONS';

export interface DashboardCard {
  key: DashboardCardKey;
  section: DashboardSection;
  label: string;
  value: string;
  /** Further figures from the same report shown under the value, e.g. the invoice count. */
  details: Array<{ label: string; value: string; kind: 'MONEY' | 'COUNT' }>;
  /** PERIOD: over dateFrom–asOfDate; AS_OF: a balance on asOfDate. */
  measure: 'PERIOD' | 'AS_OF';
  basis: ReportBasis;
  reportKey: ReportKey;
  reportTitle: string;
  reportPath: string;
}

export type DashboardAttentionKind = 'OVERDUE_INVOICE' | 'BILLING_DUE' | 'EMD_SD_OVERDUE' | 'TDS_DEPOSIT_OVERDUE' | 'LEDGER_DIFFERENCE';

export interface DashboardAttentionItem {
  kind: DashboardAttentionKind;
  title: string;
  detail: string;
  amount: string | null;
  date: string | null;
  href: string;
}

/** One figure of the financial summary (ADR-159), taken from the report at `reportPath`. */
export interface DashboardFigure {
  key: string;
  label: string;
  value: string;
  details: Array<{ label: string; value: string; kind: 'MONEY' | 'COUNT' | 'PERCENT' | 'TEXT' }>;
  measure: 'PERIOD' | 'AS_OF';
  reportPath: string;
}

/** A total and its parts, largest first. `percent` is the part's share of `total`; null where shares do not apply (GST). */
export interface DashboardBreakdown {
  key: 'EXPENSE_BY_CATEGORY' | 'EXPENSE_BY_PROJECT_TYPE' | 'GST_POSITION' | 'RECEIVABLE_COMPOSITION';
  title: string;
  /** What `total` is, e.g. "net payable" or "locked". */
  totalLabel: string;
  total: string;
  note: string | null;
  measure: 'PERIOD' | 'AS_OF';
  reportPath: string;
  rows: Array<{ label: string; amount: string; percent: string | null; note: string | null }>;
}

/**
 * The financial summary at the top of the Dashboard (ADR-159). Net profit is
 * accrual: income invoiced less every posted cost, salaries included, as the
 * Project P&L states it. Each part is null or left out without its report's
 * permission.
 */
export interface DashboardFinance {
  headline: DashboardFigure[];
  recover: DashboardFigure[];
  breakdowns: DashboardBreakdown[];
}

export interface DashboardOverview {
  scope: { legalEntityId: string | null; legalEntityName: string | null; dateFrom: string; asOfDate: string; currency: 'INR'; restricted: boolean };
  cards: DashboardCard[];
  /** Money in and out of all bank accounts by month (Cash Flow); null without report.cash.read. */
  cashTrend: Array<{ month: string; inflow: string; outflow: string }> | null;
  /** Invoice outstanding by age (Receivable Aging's own buckets); null without its permission. */
  receivableAging: AgingBucketTotal[] | null;
  /** Owed to vendors by age (Payables Aging's own buckets); null without its permission. */
  payablesAging: AgingBucketTotal[] | null;
  /** The projects with the most income in the period, from Project P&L's own rows; null without its permission. */
  topProjects: Array<{ projectId: string; projectName: string; income: string; contribution: string }> | null;
  attention: DashboardAttentionItem[];
  finance: DashboardFinance;
}

export interface DashboardPort {
  getOverview(input: { organizationId: string; actorId: string; canSeeAllProjects: boolean; permissions: string[]; filters: DashboardFilters }): Promise<DashboardOverview>;
}
