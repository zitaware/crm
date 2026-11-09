'use client';

import { StatusTag } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export type DirectExpenseStatus = 'DRAFT' | 'POSTED' | 'CANCELLED' | 'REVERSED';
export type DirectExpenseSupplyType = 'INTRASTATE' | 'INTERSTATE';
export type DirectExpenseSpendType = 'SERVER' | 'SUBSCRIPTION';
export const SPEND_TYPE_LABEL: Record<DirectExpenseSpendType, string> = { SERVER: 'Server', SUBSCRIPTION: 'Subscription' };

export interface DirectExpenseRow {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  expenseCategoryId: string;
  expenseCategoryName: string;
  vendorId: string | null;
  vendorName: string | null;
  title: string;
  projectId: string | null;
  projectName: string | null;
  taxableAmount: string;
  amount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstRatePercent: string | null;
  supplyType: DirectExpenseSupplyType | null;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  gstAmount: string;
  itcEligible: boolean;
  tdsAmount: string;
  tdsRatePercent: string | null;
  paymentModeId: string;
  paymentModeLabel: string;
  bankAccountId: string | null;
  bankAccountName: string | null;
  cardAccountId: string | null;
  cardAccountLabel: string | null;
  transactionReference: string | null;
  purchasedByEmployeeId: string | null;
  purchasedByEmployeeName: string | null;
  note: string | null;
  spendType: DirectExpenseSpendType | null;
  billUrl: string | null;
  status: DirectExpenseStatus;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  createdAt: string;
  createdBy: string | null;
  version: number;
}

const STATUS_TONE: Record<DirectExpenseStatus, StatusTagTone> = {
  DRAFT: 'mut',
  POSTED: 'pos',
  CANCELLED: 'mut',
  REVERSED: 'neg',
};
const STATUS_TEXT: Record<DirectExpenseStatus, string> = {
  DRAFT: 'Draft',
  POSTED: 'Posted',
  CANCELLED: 'Cancelled',
  REVERSED: 'Reversed',
};

export function DirectExpenseStatusTag({ status }: { status: DirectExpenseStatus }) {
  return <StatusTag status={status} label={STATUS_TEXT[status]} tone={STATUS_TONE[status]} />;
}
