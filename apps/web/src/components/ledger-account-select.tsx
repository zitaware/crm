'use client';

import type { LedgerAccountSummary } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { QuickAddSelect } from '@/components/quick-add-select';
import { LedgerAccountAddBox, ledgerAccountLabel } from '@/components/ledger-account-fields';

/**
 * The ledger account picker on entry forms. It lists "Name (CODE)" of active
 * accounts, narrowed by `filterAccounts` when given (e.g. postable bank or
 * cash ledgers). F2 opens the full Add Ledger Account form with what was
 * typed as the name, and selects the new account. Adding is offered only to
 * those who may manage the Chart of Accounts.
 */
export function LedgerAccountSelect({
  value,
  onChange,
  filterAccounts,
  placeholder = 'Select account…',
  allowClear,
  disabled,
}: {
  value?: string | undefined;
  onChange?: (value: string | undefined) => void;
  /** Narrows the active accounts offered. A new account is shown even when it falls outside. */
  filterAccounts?: (accounts: LedgerAccountSummary[]) => LedgerAccountSummary[];
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const accounts = trpc.chartOfAccounts.listAccounts.useQuery();
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('chart_of_account.manage');
  const rows = accounts.data ?? [];
  const shown = filterAccounts ? filterAccounts(rows) : rows;

  return (
    <QuickAddSelect
      value={value}
      {...(onChange ? { onChange } : {})}
      options={shown.map((a) => ({ value: a.id, label: ledgerAccountLabel(a) }))}
      loading={accounts.isLoading}
      placeholder={placeholder}
      {...(allowClear ? { allowClear: true } : {})}
      {...(disabled ? { disabled: true } : {})}
      noun="ledger account"
      canAdd={canAdd}
      renderAdd={(box) => <LedgerAccountAddBox {...box} />}
    />
  );
}
