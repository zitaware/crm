'use client';

import { useState } from 'react';
import { App, Input, Modal, Select } from 'antd';
import { trpc } from '@/server/trpc';

export function IntroducerSelect({
  value,
  onChange,
  placeholder,
  allowClear,
  disabled,
  className,
}: {
  value?: string | null | undefined;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const canCreate = (me.data?.permissions ?? []).includes('introducer.create');
  const list = trpc.introducers.list.useQuery({ includeInactive: false });
  const create = trpc.introducers.create.useMutation();

  const [search, setSearch] = useState('');
  const [popupOpen, setPopupOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [added, setAdded] = useState<Array<{ value: string; label: string }>>([]);

  const options = (list.data ?? []).map((row) => ({ value: row.id, label: row.name }));
  for (const extra of added) {
    if (!options.some((option) => option.value === extra.value)) options.push(extra);
  }

  function openPopup() {
    if (disabled) return;
    setName(search.trim());
    setPhone('');
    setPopupOpen(true);
  }

  function onF2(event: { key: string; preventDefault: () => void; stopPropagation: () => void }) {
    if (event.key !== 'F2' || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openPopup();
  }

  async function save() {
    const nextName = name.trim();
    if (!nextName) {
      message.error('Name is required.');
      return;
    }
    try {
      const created = await create.mutateAsync({ name: nextName, phone: phone.trim() || undefined });
      await utils.introducers.list.invalidate();
      message.success('Introducer added.');
      setAdded((current) => [...current, { value: created.id, label: nextName }]);
      onChange?.(created.id);
      setPopupOpen(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not add this introducer.');
    }
  }

  return (
    <div className={className ?? 'w-full'} onKeyDownCapture={onF2}>
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        loading={list.isLoading}
        options={options}
        onSearch={setSearch}
        onInputKeyDown={onF2}
        {...(placeholder ? { placeholder } : {})}
        {...(disabled ? { disabled: true } : {})}
        {...(allowClear ? { allowClear: true } : {})}
        value={value ?? null}
        onChange={(next: string | null | undefined) => onChange?.(next ?? undefined)}
        dropdownRender={(menu) => (
          <>
            {menu}
            <div className="border-t border-ui px-3 py-1.5 text-[11px] text-muted">Press F2 to add a new introducer</div>
          </>
        )}
      />
      <Modal
        open={popupOpen}
        title={canCreate ? 'Add introducer' : 'Not allowed'}
        onCancel={() => setPopupOpen(false)}
        okText={canCreate ? 'Save' : 'Close'}
        confirmLoading={canCreate && create.isPending}
        {...(!canCreate ? { cancelButtonProps: { style: { display: 'none' as const } } } : {})}
        onOk={() => {
          if (canCreate) void save();
          else setPopupOpen(false);
        }}
        destroyOnHidden
      >
        {me.isSuccess && !canCreate ? <p className="m-0 text-[13.5px] text-ink">Not allowed. Contact administration.</p> : null}
        {canCreate ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Name
              <Input value={name} autoFocus maxLength={200} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Phone
              <Input value={phone} maxLength={30} placeholder="Optional" onChange={(event) => setPhone(event.target.value)} />
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
