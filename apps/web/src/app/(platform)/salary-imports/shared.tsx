'use client';

import { StatusTag } from '@zitaware/ui';
import type {
  SalaryImportRowStatus as ContractSalaryImportRowStatus,
  SalaryImportStatus as ContractSalaryImportStatus,
  SalaryImportSummary,
  SalaryPaymentStatus as ContractSalaryPaymentStatus,
} from '@zitaware/contracts';

// Aliased to the contract rather than re-declared. These were hand-written
// copies and drifted: ADR-098 added DRAFT and made journalEntryId nullable,
// the copies never followed, and the Journal button happily navigated to
// /journal-entries/null. Aliasing turns the next such drift into a compile
// error instead of a dead link.
export type SalaryImportStatus = ContractSalaryImportStatus;
export type SalaryImportRow = SalaryImportSummary;
export type SalaryImportRowStatus = ContractSalaryImportRowStatus;
export type SalaryPaymentStatus = ContractSalaryPaymentStatus;

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

// An exhaustive Record, not a ternary. The ternary this replaces labelled a
// DRAFT batch "Reversed" in red, because it only knew two of the three states
// — the same drift that produced the dead Journal link.
const IMPORT_STATUS: Record<SalaryImportStatus, { label: string; tone: 'pos' | 'neg' | 'warn' }> = {
  DRAFT: { label: 'Draft', tone: 'warn' },
  POSTED: { label: 'Posted', tone: 'pos' },
  REVERSED: { label: 'Reversed', tone: 'neg' },
};

export function SalaryImportStatusTag({ status }: { status: SalaryImportStatus }) {
  const { label, tone } = IMPORT_STATUS[status];
  return <StatusTag status={status} label={label} tone={tone} />;
}

const PAYMENT_STATUS: Record<SalaryPaymentStatus, { label: string; tone: 'pos' | 'neg' }> = {
  POSTED: { label: 'Posted', tone: 'pos' },
  REVERSED: { label: 'Reversed', tone: 'neg' },
};

export function SalaryPaymentStatusTag({ status }: { status: SalaryPaymentStatus }) {
  const { label, tone } = PAYMENT_STATUS[status];
  return <StatusTag status={status} label={label} tone={tone} />;
}

const ROW_STATUS_TONE: Record<SalaryImportRowStatus, 'pos' | 'neg' | 'warn'> = {
  MATCHED: 'pos',
  UNMATCHED: 'neg',
  DUPLICATE: 'neg',
  INACTIVE: 'warn',
  INVALID_AMOUNT: 'neg',
  AMBIGUOUS: 'warn',
};
const ROW_STATUS_TEXT: Record<SalaryImportRowStatus, string> = {
  MATCHED: 'Matched',
  UNMATCHED: 'No match',
  DUPLICATE: 'Duplicate',
  INACTIVE: 'Inactive',
  INVALID_AMOUNT: 'Bad amount',
  AMBIGUOUS: 'Choose employee',
};

export function RowStatusTag({ status }: { status: SalaryImportRowStatus }) {
  return <StatusTag status={status} label={ROW_STATUS_TEXT[status]} tone={ROW_STATUS_TONE[status]} />;
}

/** Format a YYYY-MM-01 salary month as "March 2026". */
export function formatSalaryMonth(value: string): string {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface ParsedRow {
  employeeCode: string;
  employeeName: string | undefined;
  grossSalaryAmount: string;
}

/**
 * Parses a pasted or uploaded CSV into the rows the server validates.
 *
 * Deliberately dumb: it splits, trims and strips currency punctuation, and
 * does not decide whether a row is usable — every judgement about matching,
 * duplicates, inactive employees and bad amounts belongs to the server's own
 * `preview`, which is the same code the commit runs. A header row is skipped
 * when its first cell does not look like data.
 *
 * Only CSV is parsed. .xlsx is a zip of XML and would need a parser
 * dependency this project has not taken; exporting the sheet to CSV first is
 * the documented path.
 */
export function parseCsv(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const split = (line: string): string[] =>
    line.split(',').map((cell) => cell.trim().replace(/^"(.*)"$/, '$1').trim());

  const first = split(lines[0]!);
  const looksLikeHeader = first.length > 0 && /code|employee|name|gross|salary|amount/i.test(first.join(' ')) && !/^\d/.test(first[first.length - 1] ?? '');
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cells = split(line);
    // Two columns => name, amount: the code is found from the name (ADR-170).
    // Three or more => code, name, amount, as older sheets have it.
    const employeeCode = cells.length >= 3 ? (cells[0] ?? '') : '';
    const grossRaw = cells.length >= 3 ? (cells[2] ?? '') : (cells[1] ?? '');
    const employeeName = cells.length >= 3 ? cells[1] || undefined : cells[0] || undefined;
    return {
      employeeCode,
      employeeName,
      // Strip thousands separators, currency symbols and stray spaces — the
      // server rejects anything still unparseable, it is not guessed at here.
      grossSalaryAmount: grossRaw.replace(/[,\s₹]/g, ''),
    };
  });
}
