'use client';

import { trpc } from '@/server/trpc';
import { QuickAddSelect } from '@/components/quick-add-select';
import { CardAccountAddBox, cardAccountLabel, type CardType } from '@/components/card-account-fields';

/**
 * The card picker on entry forms. It lists active cards as
 * "Name •••• 1234", only those of `legalEntityId` and of `cardType` when
 * given (ADR-183); the chosen card stays listed even once deactivated, so an
 * edit form still shows it. F2 opens Add Card with what was typed as the
 * name and the form's legal entity and type, and selects the new card.
 * Adding is offered only to those who may manage legal entities.
 */
export function CardAccountSelect({
  value,
  onChange,
  legalEntityId,
  cardType,
  placeholder = 'Select card…',
  disabled,
  allowClear,
  className,
}: {
  value?: string | null | undefined;
  onChange?: (value: string | undefined) => void;
  /** Lists only this legal entity's cards, and adds the new one to it. */
  legalEntityId?: string | undefined;
  /** Lists only cards of this type, and adds the new one as such. */
  cardType?: CardType | undefined;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const cards = trpc.legalEntities.listCardAccounts.useQuery({ includeInactive: true });
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('legal_entity.manage');

  const options = (cards.data ?? [])
    .filter((c) => (c.isActive || c.id === value) && (!legalEntityId || c.legalEntityId === legalEntityId) && (!cardType || c.type === cardType))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((c) => ({ value: c.id, label: cardAccountLabel(c) }));

  return (
    <QuickAddSelect
      value={value}
      {...(onChange ? { onChange } : {})}
      options={options}
      loading={cards.isLoading}
      placeholder={placeholder}
      {...(disabled ? { disabled: true } : {})}
      {...(allowClear ? { allowClear: true } : {})}
      {...(className ? { className } : {})}
      noun="card"
      canAdd={canAdd}
      renderAdd={(box) => <CardAccountAddBox {...box} legalEntityId={legalEntityId} cardType={cardType} />}
    />
  );
}
