'use client';

import { StatusTag } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export type EmployeeAdvanceStatus = 'POSTED' | 'REVERSED';
export type EmployeeExpenseClaimStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REIMBURSED';
export type EmployeeExpenseClaimDecisionType = 'APPROVED' | 'REJECTED';

export interface EmployeeAdvanceRow {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  employeeId: string;
  employeeName: string;
  projectId: string | null;
  projectName: string | null;
  amount: string;
  advanceDate: string;
  paymentModeId: string;
  paymentModeLabel: string;
  bankAccountId: string;
  bankAccountName: string;
  utrReference: string | null;
  purpose: string | null;
  note: string | null;
  status: EmployeeAdvanceStatus;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversalReason: string | null;
  reversedBy: string | null;
  reversedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  version: number;
}

export interface EmployeeExpenseClaimDecisionRow {
  id: string;
  decision: EmployeeExpenseClaimDecisionType;
  actorId: string;
  decidedAt: string;
  note: string | null;
  isSelfApproval: boolean;
  actorName: string | null;
}

export interface EmployeeExpenseClaimRow {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  employeeId: string;
  employeeName: string;
  expenseCategoryId: string;
  expenseCategoryName: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  amount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstCreditAmount: string;
  note: string | null;
  status: EmployeeExpenseClaimStatus;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  journalEntryId: string | null;
  reimbursementJournalEntryId: string | null;
  reimbursementReversalJournalEntryId: string | null;
  reimbursementReversalReason: string | null;
  reimbursedAt: string | null;
  reimbursedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  version: number;
  approval: { rule: 'LISTED'; approverNames: string[]; approverUserIds: string[] } | null;
  lastDecision: { decision: EmployeeExpenseClaimDecisionType; byName: string | null; at: string } | null;
  reimbursedByName: string | null;
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/**
 * Who approves a claim while it waits, then who approved or rejected it and
 * who reimbursed it (ADR-171). Names come from the API.
 */
export function ClaimApprovalLine({ claim }: { claim: EmployeeExpenseClaimRow }) {
  const lines: Array<{ key: string; text: string; tone: string }> = [];
  if (claim.status === 'SUBMITTED' && claim.approval) {
    const names = claim.approval.approverNames.join(', ') || 'no approver yet';
    lines.push({
      key: 'waiting',
      text: `Waiting for: ${names}`,
      tone: 'text-warning',
    });
  }
  if (claim.lastDecision && claim.status !== 'SUBMITTED') {
    const verb = claim.lastDecision.decision === 'APPROVED' ? 'Approved' : 'Rejected';
    lines.push({ key: 'decided', text: `${verb} by ${claim.lastDecision.byName ?? '—'} · ${shortDate(claim.lastDecision.at)}`, tone: 'text-muted' });
  }
  if (claim.reimbursedAt && claim.status === 'REIMBURSED') {
    lines.push({ key: 'paid', text: `Reimbursed by ${claim.reimbursedByName ?? '—'} · ${shortDate(claim.reimbursedAt)}`, tone: 'text-positive' });
  }
  if (lines.length === 0) return <span className="text-muted">—</span>;
  return (
    <div className="text-[11.5px] leading-snug">
      {lines.map((l) => (
        <div key={l.key} className={l.tone}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** Whether this user may approve or reject the claim: the API holds the same rule (ADR-171). */
export function mayDecide(claim: EmployeeExpenseClaimRow, userId: string | undefined): boolean {
  return !claim.approval || (!!userId && claim.approval.approverUserIds.includes(userId));
}

export interface EmployeeExpenseClaimDetailData extends EmployeeExpenseClaimRow {
  decisions: EmployeeExpenseClaimDecisionRow[];
}

const CLAIM_STATUS_TONE: Record<EmployeeExpenseClaimStatus, StatusTagTone> = {
  DRAFT: 'mut',
  SUBMITTED: 'warn',
  APPROVED: 'info',
  REJECTED: 'neg',
  CANCELLED: 'mut',
  REIMBURSED: 'pos',
};
const CLAIM_STATUS_TEXT: Record<EmployeeExpenseClaimStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Pending Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  REIMBURSED: 'Reimbursed',
};

export function EmployeeExpenseClaimStatusTag({ status }: { status: EmployeeExpenseClaimStatus }) {
  return <StatusTag status={status} label={CLAIM_STATUS_TEXT[status]} tone={CLAIM_STATUS_TONE[status]} />;
}

const ADVANCE_STATUS_TONE: Record<EmployeeAdvanceStatus, StatusTagTone> = { POSTED: 'pos', REVERSED: 'neg' };
const ADVANCE_STATUS_TEXT: Record<EmployeeAdvanceStatus, string> = { POSTED: 'Posted', REVERSED: 'Reversed' };

export function EmployeeAdvanceStatusTag({ status }: { status: EmployeeAdvanceStatus }) {
  return <StatusTag status={status} label={ADVANCE_STATUS_TEXT[status]} tone={ADVANCE_STATUS_TONE[status]} />;
}
