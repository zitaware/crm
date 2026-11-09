import { Prisma } from '@zitaware/database';
import type { LedgerReconciliation, LedgerReconciliationLine, ReportReadInput } from '@zitaware/contracts';

export type LedgerAccountRef = { id: string; code: string; name: string };

/** A restricted view is never compared with the whole ledger (ADR-108). */
export function notComparable(input: ReportReadInput, reason: string): LedgerReconciliation {
  return {
    applicable: false,
    notApplicableReason: input.canSeeAllProjects ? reason : 'You can see only the projects assigned to you, so these totals cannot be compared with the whole ledger.',
    lines: [],
    allReconciled: false,
  };
}

/** One report figure against a ledger figure the caller has already signed to match it. */
export function reconciliationLine(key: string, label: string, account: LedgerAccountRef | undefined, reportAmount: Prisma.Decimal, ledgerAmount: Prisma.Decimal, extraAccounts: LedgerAccountRef[] = []): LedgerReconciliationLine {
  const difference = reportAmount.minus(ledgerAmount);
  return {
    key,
    label,
    ledgerAccounts: [...(account ? [account] : []), ...extraAccounts],
    reportAmount: reportAmount.toFixed(2),
    ledgerAmount: ledgerAmount.toFixed(2),
    difference: difference.toFixed(2),
    reconciled: difference.isZero(),
  };
}

export const reconciled = (lines: LedgerReconciliationLine[]): LedgerReconciliation => ({ applicable: true, notApplicableReason: null, lines, allReconciled: lines.every((l) => l.reconciled) });
