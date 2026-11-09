'use client';

import { trpc } from '@/server/trpc';
import { QuickAddSelect } from '@/components/quick-add-select';
import { BankAccountAddBox, bankAccountLabel } from '@/components/bank-account-fields';

/**
 * The bank account picker on entry forms. It lists active accounts as
 * "Name · ****1234", only those of `legalEntityId` when one is given
 * (ADR-183); the chosen account stays listed even once deactivated, so an
 * edit form still shows it. F2 opens Add Bank Account with what was typed as
 * the name and the form's legal entity, and selects the new account. Adding
 * is offered only to those who may manage legal entities.
 */
export function BankAccountSelect({
  value,
  onChange,
  legalEntityId,
  placeholder = 'Select account…',
  disabled,
  allowClear,
  className,
}: {
  value?: string | null | undefined;
  onChange?: (value: string | undefined) => void;
  /** Lists only this legal entity's accounts, and adds the new one to it. */
  legalEntityId?: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const accounts = trpc.legalEntities.listBankAccounts.useQuery({ includeInactive: true });
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('legal_entity.manage');

  const options = (accounts.data ?? [])
    .filter((b) => (b.isActive || b.id === value) && (!legalEntityId || b.legalEntityId === legalEntityId))
    .sort((a, b) => a.accountName.localeCompare(b.accountName))
    .map((b) => ({ value: b.id, label: bankAccountLabel(b) }));

  return (
    <QuickAddSelect
      value={value}
      {...(onChange ? { onChange } : {})}
      options={options}
      loading={accounts.isLoading}
      placeholder={placeholder}
      {...(disabled ? { disabled: true } : {})}
      {...(allowClear ? { allowClear: true } : {})}
      {...(className ? { className } : {})}
      noun="bank account"
      canAdd={canAdd}
      renderAdd={(box) => <BankAccountAddBox {...box} legalEntityId={legalEntityId} />}
    />
  );
}
