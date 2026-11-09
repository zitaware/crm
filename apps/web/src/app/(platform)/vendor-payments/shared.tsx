'use client';

import { StatusTag } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';
import { newIdempotencyKey } from '../vendor-bills/shared';

export { newIdempotencyKey };

export type VendorPaymentStatus = 'POSTED' | 'REVERSED';
/** TDS/GST-TDS subset only (docs/12 ADR-080) — Hold/Retention/Penalty-on-
 * payment and a TDS section/rate master were both confirmed out of scope. */
export type VendorPaymentDeductionType = 'TDS' | 'CGST_TDS' | 'SGST_TDS' | 'IGST_TDS';

export const DEDUCTION_TYPE_OPTIONS: Array<{ value: VendorPaymentDeductionType; label: string }> = [
  { value: 'TDS', label: 'TDS (on base)' },
  { value: 'CGST_TDS', label: 'GST-TDS — CGST (on base)' },
  { value: 'SGST_TDS', label: 'GST-TDS — SGST (on base)' },
  { value: 'IGST_TDS', label: 'GST-TDS — IGST (on base)' },
];

export const DEDUCTION_TYPE_LABEL: Record<VendorPaymentDeductionType, string> = Object.fromEntries(
  DEDUCTION_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<VendorPaymentDeductionType, string>;

export interface EligiblePaymentRequestLineRow {
  id: string;
  paymentRequestId: string;
  requestNumber: string | null;
  vendorBillId: string;
  vendorBillNumber: string;
  projectId: string | null;
  projectName: string | null;
  vendorBillTaxableAmount: string;
  requestedAmount: string;
  availableToPay: string;
}

export interface VendorPaymentDeductionRow {
  id: string;
  type: VendorPaymentDeductionType;
  amount: string;
  ratePercent: string | null;
  narrative: string | null;
}

export interface VendorPaymentAllocationRow {
  id: string;
  paymentRequestLineId: string;
  paymentRequestId: string;
  requestNumber: string | null;
  vendorBillId: string;
  vendorBillNumber: string;
  vendorBillTaxableAmountSnapshot: string;
  requestedAmountSnapshot: string;
  cashPaid: string;
  settledAmount: string;
  deductions: VendorPaymentDeductionRow[];
}

export interface VendorPaymentRow {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  bankAccountId: string;
  bankAccountName: string | null;
  /** Set instead of the bank when paid by credit card (ADR-179). */
  cardAccountLabel: string | null;
  paymentModeId: string;
  paymentModeLabel: string;
  paymentDate: string;
  utrReference: string | null;
  actualAmount: string;
  status: VendorPaymentStatus;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  vendorName: string;
  projectIds: string[];
  projectNames: string[];
  vendorBillNumbers: string[];
  version: number;
}

export interface VendorPaymentDetailData extends VendorPaymentRow {
  allocations: VendorPaymentAllocationRow[];
}

const STATUS_TONE: Record<VendorPaymentStatus, StatusTagTone> = {
  POSTED: 'pos',
  REVERSED: 'neg',
};
const STATUS_TEXT: Record<VendorPaymentStatus, string> = {
  POSTED: 'Posted',
  REVERSED: 'Reversed',
};

export function VendorPaymentStatusTag({ status }: { status: VendorPaymentStatus }) {
  return <StatusTag status={status} label={STATUS_TEXT[status]} tone={STATUS_TONE[status]} />;
}
