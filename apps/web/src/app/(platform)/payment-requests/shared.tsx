'use client';

import { StatusTag } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';
import { newIdempotencyKey, PRIORITY_OPTIONS } from '../vendor-bills/shared';
import type { VendorBillPriority } from '../vendor-bills/shared';

export { newIdempotencyKey, PRIORITY_OPTIONS };

export type PaymentRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REVOKED';
export type PaymentRequestDecisionType = 'APPROVED' | 'REJECTED' | 'REVOKED';
/** Reuses Vendor Bill's own priority enum (itself renamed from
 * PurchaseRequestPriority when Purchase Request was merged into Vendor
 * Bill, Phase 6.4) — no separate Payment Request priority type exists
 * server-side. */
export type PaymentRequestPriority = VendorBillPriority;

export interface EligibleVendorBillRow {
  vendorBillId: string;
  vendorBillNumber: string;
  projectId: string | null;
  projectName: string | null;
  vendorBillDate: string;
  dueDate: string | null;
  totalAmount: string;
  alreadyReserved: string;
  availableForRequest: string;
}

export interface PaymentRequestLineRow {
  id: string;
  vendorBillId: string;
  vendorBillNumber: string;
  projectId: string | null;
  projectName: string | null;
  vendorBillDate: string;
  vendorBillTotalAmount: string;
  requestedAmount: string;
}

export interface PaymentRequestDecisionRow {
  id: string;
  decision: PaymentRequestDecisionType;
  actorId: string;
  decidedAt: string;
  note: string | null;
  isSelfApproval: boolean;
}

export interface PaymentRequestRow {
  id: string;
  requestNumber: string | null;
  vendorId: string;
  vendorName: string;
  legalEntityId: string;
  legalEntityName: string;
  requestedPaymentDate: string;
  priority: PaymentRequestPriority;
  remarks: string | null;
  totalRequestedAmount: string | null;
  status: PaymentRequestStatus;
  createdBy: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  createdAt: string;
  version: number;
}

export interface PaymentRequestDetailData extends PaymentRequestRow {
  lines: PaymentRequestLineRow[];
  decisions: PaymentRequestDecisionRow[];
}

const STATUS_TONE: Record<PaymentRequestStatus, StatusTagTone> = {
  DRAFT: 'mut',
  SUBMITTED: 'warn',
  APPROVED: 'pos',
  REJECTED: 'neg',
  CANCELLED: 'mut',
  REVOKED: 'neg',
};
const STATUS_TEXT: Record<PaymentRequestStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  REVOKED: 'Revoked',
};

export function PaymentRequestStatusTag({ status }: { status: PaymentRequestStatus }) {
  return <StatusTag status={status} label={STATUS_TEXT[status]} tone={STATUS_TONE[status]} />;
}
