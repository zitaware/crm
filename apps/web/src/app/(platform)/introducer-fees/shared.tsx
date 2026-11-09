'use client';

import { StatusTag } from '@zitaware/ui';
import type {
  IntroducerAccrualSummary,
  IntroducerAgreementSummary,
  IntroducerBalanceRow as ContractIntroducerBalanceRow,
  IntroducerCommissionBasis as ContractIntroducerCommissionBasis,
  IntroducerDocumentStatus as ContractIntroducerDocumentStatus,
  IntroducerPaymentSummary,
} from '@zitaware/contracts';

// Aliased to the contract rather than re-declared. Hand-written copies drift
// silently — a stale copy in the salary-imports screen is what produced a
// Journal button linking to /journal-entries/null. Aliasing makes the next
// contract change a compile error here instead.
export type IntroducerCommissionBasis = ContractIntroducerCommissionBasis;
export type IntroducerDocumentStatus = ContractIntroducerDocumentStatus;
export type IntroducerBalanceRow = ContractIntroducerBalanceRow;
export type IntroducerAgreementRow = IntroducerAgreementSummary;
export type IntroducerAccrualRow = IntroducerAccrualSummary;
export type IntroducerPaymentRow = IntroducerPaymentSummary;

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

export function IntroducerStatusTag({ status }: { status: IntroducerDocumentStatus }) {
  return (
    <StatusTag
      status={status}
      label={status === 'POSTED' ? 'Posted' : 'Reversed'}
      tone={status === 'POSTED' ? 'pos' : 'neg'}
    />
  );
}

/** How the commission is defined, phrased the way the agreement states it —
 * never converted into the other basis, which would hide the actual term. */
export function describeBasis(row: Pick<IntroducerAgreementRow, 'basisType' | 'ratePercent' | 'fixedAmount'>): string {
  if (row.basisType === 'PERCENT_OF_PROJECT_VALUE') {
    return `${Number(row.ratePercent ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}% of project value`;
  }
  return 'Fixed amount';
}
