'use client';

import { useState, type ReactNode } from 'react';
import { Select } from 'antd';

export interface QuickAddOption {
  value: string;
  label: string;
}

/** What a picker's add box is given: the text typed so far, and how to close or report the new record. */
export interface QuickAddBoxProps {
  open: boolean;
  initialText: string;
  onClose: () => void;
  /** The new record, selected at once and listed until the refreshed list has it. */
  onCreated: (option: QuickAddOption) => void;
}

/**
 * A searchable dropdown where F2 (or the line under the list) opens a box to
 * add a new record and selects it, as Vendors, Employees and the masters do.
 * The box is the record's own create form (`renderAdd`), so no field is left
 * out. F2 pressed inside the open box belongs to the box's own pickers.
 */
export function QuickAddSelect({
  value,
  onChange,
  options,
  loading,
  placeholder,
  disabled,
  allowClear,
  className,
  noun,
  canAdd,
  renderAdd,
}: {
  value?: string | null | undefined;
  onChange?: (value: string | undefined) => void;
  options: QuickAddOption[];
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  /** "bank account", "client"… */
  noun: string;
  /** False when the user may not create this record: the dropdown then works as a plain one. */
  canAdd: boolean;
  renderAdd: (box: QuickAddBoxProps) => ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [initialText, setInitialText] = useState('');
  const [added, setAdded] = useState<QuickAddOption[]>([]);

  const shown = [...options];
  for (const extra of added) if (!shown.some((o) => o.value === extra.value)) shown.push(extra);

  const openAdd = () => {
    if (!canAdd || disabled) return;
    setInitialText(search.trim());
    setOpen(true);
  };
  const onF2 = (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
    if (event.key !== 'F2' || open) return;
    event.preventDefault();
    event.stopPropagation();
    openAdd();
  };

  return (
    <div className={className ?? 'w-full'} onKeyDownCapture={onF2}>
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        loading={!!loading}
        value={value ?? null}
        onChange={(next: string | null | undefined) => onChange?.(next ?? undefined)}
        onSearch={setSearch}
        {...(placeholder ? { placeholder } : {})}
        {...(disabled ? { disabled: true } : {})}
        {...(allowClear ? { allowClear: true } : {})}
        options={shown}
        dropdownRender={(menu) => (
          <>
            {menu}
            {canAdd ? (
              <button
                type="button"
                className="w-full border-t border-ui px-3 py-1.5 text-left text-[11px] text-muted hover:text-brand"
                onMouseDown={(e) => e.preventDefault()}
                onClick={openAdd}
              >
                Press F2 (or click here) to add a new {noun}
                {search.trim() ? ` “${search.trim()}”` : ''}
              </button>
            ) : null}
          </>
        )}
      />
      {canAdd
        ? renderAdd({
            open,
            initialText,
            onClose: () => setOpen(false),
            onCreated: (option) => {
              setAdded((current) => [...current, option]);
              onChange?.(option.value);
              setOpen(false);
            },
          })
        : null}
    </div>
  );
}
