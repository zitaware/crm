import type { TaxDeductionType } from './tds-certificate.port';

/**
 * TDS and GST-TDS deposits — challans (Phase 8.5b, ADR-113). A deposit pays
 * specific withheld amounts: it posts Dr TDS/GST-TDS Payable, Cr Bank
 * (docs/06 "TDS deposited") for exactly the total of its allocations.
 */

export type TdsDepositStatus = 'POSTED' | 'REVERSED';
export type TdsOutwardSourceKind = 'VENDOR_PAYMENT_DEDUCTION' | 'DIRECT_EXPENSE' | 'INTRODUCER_PAYMENT' | 'SALARY_PAYMENT_LINE';
export const TDS_OUTWARD_SOURCE_KINDS: readonly TdsOutwardSourceKind[] = ['VENDOR_PAYMENT_DEDUCTION', 'DIRECT_EXPENSE', 'INTRODUCER_PAYMENT', 'SALARY_PAYMENT_LINE'];

/** One amount withheld from a payment, and how much of it has been deposited. */
export interface TdsOutwardItem {
  sourceKind: TdsOutwardSourceKind;
  sourceId: string;
  deductionType: TaxDeductionType;
  /** The document to open: vendor payment, direct expense, introducer payment or salary payment. */
  documentId: string;
  documentLabel: string;
  /** The payment's date — when the tax was withheld. */
  deductionDate: string;
  deducteeName: string;
  amount: string;
  deposited: string;
  remaining: string;
  challanNumbers: string[];
  /** 7th of the next month for TDS (30 April for March), 10th of the next month for GST-TDS. */
  dueDate: string;
  overdue: boolean;
}

export interface TdsDepositSummary {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  bankAccountId: string;
  bankAccountName: string;
  deductionType: TaxDeductionType;
  challanNumber: string;
  depositDate: string;
  amount: string;
  remarks: string | null;
  status: TdsDepositStatus;
  journalEntryId: string;
  reversalJournalEntryId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  allocationCount: number;
  createdAt: string;
  version: number;
}

export interface TdsDepositAllocationRow {
  id: string;
  sourceKind: TdsOutwardSourceKind;
  sourceId: string;
  documentId: string;
  documentLabel: string;
  deductionDate: string;
  deducteeName: string;
  amount: string;
}

export interface TdsDepositDetail extends TdsDepositSummary {
  allocations: TdsDepositAllocationRow[];
}

export interface TdsDepositPort {
  list(input: { organizationId: string; status: TdsDepositStatus | undefined; deductionType: TaxDeductionType | undefined }): Promise<TdsDepositSummary[]>;
  getDetail(input: { organizationId: string; id: string }): Promise<TdsDepositDetail>;
  listOutstanding(input: { organizationId: string; legalEntityId: string; deductionType: TaxDeductionType }): Promise<TdsOutwardItem[]>;
  post(input: {
    organizationId: string;
    legalEntityId: string;
    bankAccountId: string;
    deductionType: TaxDeductionType;
    challanNumber: string;
    depositDate: string;
    remarks: string | undefined;
    allocations: Array<{ sourceKind: TdsOutwardSourceKind; sourceId: string; amount: string }>;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
  }): Promise<TdsDepositDetail>;
  reverse(input: { organizationId: string; id: string; reason: string; accountingDate: string; expectedVersion: number; idempotencyKey: string; actorId: string; correlationId: string }): Promise<TdsDepositDetail>;
}
