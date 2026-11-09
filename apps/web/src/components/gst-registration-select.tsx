'use client';

import { trpc } from '@/server/trpc';
import { QuickAddSelect } from '@/components/quick-add-select';
import { GstRegistrationAddBox, gstRegistrationLabel } from '@/components/gst-registration-fields';

/**
 * The GST registration picker on entry forms: the registrations of
 * `legalEntityId` as "GSTIN — Trade name", none until a legal entity is
 * known. F2 opens Add GST Registration for that legal entity, with what was
 * typed as the GSTIN (or trade name), and selects the new registration.
 * Adding is offered only to those who may manage legal entities, and only
 * once the legal entity is known.
 */
export function GstRegistrationSelect({
  value,
  onChange,
  legalEntityId,
  placeholder,
  disabled,
  allowClear,
  className,
}: {
  value?: string | null | undefined;
  onChange?: (value: string | undefined) => void;
  /** Whose registrations are listed, and to whom a new one is added. */
  legalEntityId: string | undefined;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const registrations = trpc.legalEntities.listGstRegistrations.useQuery({ legalEntityId: legalEntityId ?? '' }, { enabled: !!legalEntityId });
  const canAdd = !!legalEntityId && (trpc.auth.me.useQuery().data?.permissions ?? []).includes('legal_entity.manage');
  const rows = legalEntityId ? (registrations.data ?? []) : [];

  return (
    <QuickAddSelect
      value={value}
      {...(onChange ? { onChange } : {})}
      options={rows.map((r) => ({ value: r.id, label: gstRegistrationLabel(r) }))}
      loading={!!legalEntityId && registrations.isLoading}
      {...(placeholder ? { placeholder } : {})}
      {...(disabled ? { disabled: true } : {})}
      {...(allowClear ? { allowClear: true } : {})}
      {...(className ? { className } : {})}
      noun="GST registration"
      canAdd={canAdd}
      renderAdd={(box) => (legalEntityId ? <GstRegistrationAddBox {...box} legalEntityId={legalEntityId} /> : null)}
    />
  );
}
