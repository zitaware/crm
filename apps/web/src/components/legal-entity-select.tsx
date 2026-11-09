'use client';

import { useEffect } from 'react';
import { trpc } from '@/server/trpc';
import { QuickAddSelect } from '@/components/quick-add-select';
import { LegalEntityAddBox } from '@/components/legal-entity-fields';

/**
 * The legal entity on an entry form (ADR-183). Someone who sees every legal
 * entity (Admin) chooses it, and F2 adds one if they may manage legal
 * entities; everyone else works in their own, so it is filled in for them
 * and cannot be changed.
 */
export function LegalEntitySelect({
  value,
  onChange,
  placeholder = 'Select legal entity…',
  allowClear,
  disabled,
  onUserChange,
}: {
  value?: string | undefined;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  /** Locks the choice even for those who could choose, e.g. on an edit form. */
  disabled?: boolean;
  /** Called only when someone picks (or adds) another legal entity, so a form can clear what depended on the old one. */
  onUserChange?: (value: string | undefined) => void;
}) {
  const me = trpc.auth.me.useQuery();
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });
  const rows = [...(legalEntities.data ?? [])].sort((a, b) => a.legalName.localeCompare(b.legalName));
  const canChoose = me.data?.legalEntityAccess === 'ALL';
  const canAdd = canChoose && (me.data?.permissions ?? []).includes('legal_entity.manage');
  const own = !canChoose && rows.length === 1 ? rows[0]!.id : undefined;

  // Their own legal entity is the only one they work in: fill it in.
  useEffect(() => {
    if (own && value !== own) onChange?.(own);
  }, [own, value, onChange]);

  return (
    <QuickAddSelect
      value={value}
      onChange={(next) => {
        onChange?.(next);
        onUserChange?.(next);
      }}
      options={rows.map((l) => ({ value: l.id, label: l.legalName }))}
      loading={legalEntities.isLoading || me.isLoading}
      placeholder={me.data && !canChoose && rows.length === 0 ? 'No legal entity is set for you' : placeholder}
      {...(canChoose && !disabled ? {} : { disabled: true })}
      {...(allowClear && canChoose ? { allowClear: true } : {})}
      noun="legal entity"
      canAdd={canAdd}
      renderAdd={(box) => <LegalEntityAddBox {...box} />}
    />
  );
}

/** Employees as "Name · Code", only those of the chosen legal entity, so two people of one name are told apart. */
export function employeeOptions<T extends { id: string; fullName: string; employeeCode: string; legalEntityId: string | null }>(rows: T[], legalEntityId: string | undefined) {
  return rows
    .filter((e) => !legalEntityId || e.legalEntityId === legalEntityId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((e) => ({ value: e.id, label: `${e.fullName} · ${e.employeeCode}` }));
}
