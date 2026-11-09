'use client';

import { useState } from 'react';
import { App, Input, Modal, Select } from 'antd';
import type { MasterTypeKey } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';

export type MasterSelectType = MasterTypeKey | 'penalty_categories';

const LABELS: Record<MasterSelectType, string> = {
  internal_departments: 'department',
  designations: 'designation',
  employment_types: 'employment type',
  government_body_types: 'government body type',
  client_types: 'client type',
  lead_types: 'lead type',
  lead_sources: 'lead source',
  tender_portals: 'tender portal',
  project_types: 'project type',
  security_instrument_purposes: 'security instrument purpose',
  security_instrument_types: 'security instrument type',
  document_categories: 'document category',
  expense_categories: 'expense category',
  units_of_measure: 'unit',
  product_categories: 'product category',
  allocation_targets: 'allocation target',
  penalty_categories: 'penalty category',
};

function suggestCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

function MasterCreateDialog({
  type,
  initialText,
  onClose,
  onCreated,
}: {
  type: MasterSelectType;
  initialText: string;
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('master.manage');
  const label = LABELS[type];
  const startingName = initialText.trim();
  const [name, setName] = useState(startingName);
  const [code, setCode] = useState(suggestCode(startingName));
  const [codeEdited, setCodeEdited] = useState(false);

  const createMaster = trpc.masters.create.useMutation();
  const createPenalty = trpc.penaltyCategories.create.useMutation();
  const saving = createMaster.isPending || createPenalty.isPending;

  async function save() {
    const nextName = name.trim();
    const nextCode = code.trim();
    if (!nextName || !nextCode) {
      message.error('Name and code are required.');
      return;
    }
    try {
      const created =
        type === 'penalty_categories'
          ? await createPenalty.mutateAsync({ code: nextCode, name: nextName })
          : await createMaster.mutateAsync({ type, code: nextCode, name: nextName });
      if (type === 'penalty_categories') {
        await utils.penaltyCategories.list.invalidate();
      } else {
        await utils.masters.list.invalidate({ type });
      }
      message.success(`${label[0]?.toUpperCase() ?? ''}${label.slice(1)} added.`);
      onCreated(created.id, nextName);
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not add this value.');
    }
  }

  return (
    <Modal
      open
      title={canManage ? `Add ${label}` : 'Not allowed'}
      onCancel={onClose}
      okText={canManage ? 'Save' : 'Close'}
      confirmLoading={canManage && saving}
      {...(!canManage ? { cancelButtonProps: { style: { display: 'none' as const } } } : {})}
      onOk={() => {
        if (canManage) void save();
        else onClose();
      }}
    >
      {me.isSuccess && !canManage ? (
        <p className="m-0 text-[13.5px] text-ink">Not allowed. Contact administration.</p>
      ) : null}
      {canManage ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            Name
            <Input
              value={name}
              autoFocus
              maxLength={200}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!codeEdited) setCode(suggestCode(next));
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            Code
            <Input
              value={code}
              maxLength={50}
              onChange={(event) => {
                setCodeEdited(true);
                setCode(event.target.value.toUpperCase());
              }}
            />
          </label>
        </div>
      ) : null}
    </Modal>
  );
}

export function MasterCreateModal({
  type,
  open,
  initialText,
  onClose,
  onCreated,
}: {
  type: MasterSelectType;
  open: boolean;
  initialText: string;
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  if (!open) return null;
  return (
    <MasterCreateDialog
      key={initialText}
      type={type}
      initialText={initialText}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

export function MasterSelect({
  type,
  value,
  onChange,
  placeholder,
  allowClear,
  disabled,
  className,
  includeInactive = false,
}: {
  type: MasterSelectType;
  value?: string | null | undefined;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  includeInactive?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [popupOpen, setPopupOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState<Array<{ value: string; label: string }>>([]);

  const masters = trpc.masters.list.useQuery(
    { type: type === 'penalty_categories' ? 'client_types' : type, includeInactive },
    { enabled: type !== 'penalty_categories' },
  );
  const penalties = trpc.penaltyCategories.list.useQuery({ includeInactive }, { enabled: type === 'penalty_categories' });
  const rows = type === 'penalty_categories' ? (penalties.data ?? []) : (masters.data ?? []);
  const loading = type === 'penalty_categories' ? penalties.isLoading : masters.isLoading;
  const label = LABELS[type];

  const options = rows.map((row) => ({ value: row.id, label: row.name }));
  for (const extra of added) {
    if (!options.some((option) => option.value === extra.value)) options.push(extra);
  }

  function openPopup() {
    setDraft(search.trim());
    setPopupOpen(true);
  }

  function onF2(event: { key: string; preventDefault: () => void; stopPropagation: () => void }) {
    if (event.key !== 'F2' || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openPopup();
  }

  return (
    <div className={className ?? 'w-full'} onKeyDownCapture={onF2}>
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        loading={loading}
        options={options}
        onSearch={setSearch}
        onInputKeyDown={onF2}
        {...(placeholder ? { placeholder } : {})}
        {...(disabled ? { disabled: true } : {})}
        {...(allowClear ? { allowClear: true } : {})}
        value={value ?? null}
        onChange={(next: string | null | undefined) => {
          onChange?.(next ?? undefined);
        }}
        dropdownRender={(menu) => (
          <>
            {menu}
            <div className="border-t border-ui px-3 py-1.5 text-[11px] text-muted">Press F2 to add a new {label}</div>
          </>
        )}
      />
      <MasterCreateModal
        type={type}
        open={popupOpen}
        initialText={draft}
        onClose={() => setPopupOpen(false)}
        onCreated={(id, name) => {
          setAdded((current) => [...current, { value: id, label: name }]);
          onChange?.(id);
        }}
      />
    </div>
  );
}

const GEO_LABELS = { state: 'state', district: 'district', city: 'city' } as const;

export function GeographySelect({
  kind,
  parentId,
  value,
  onChange,
  placeholder,
  allowClear,
  disabled,
  className,
}: {
  kind: 'state' | 'district' | 'city';
  parentId?: string;
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
  const canManage = (me.data?.permissions ?? []).includes('master.manage');
  const label = GEO_LABELS[kind];
  const blocked = disabled || (kind !== 'state' && !parentId);

  const states = trpc.geography.listStates.useQuery(undefined, { enabled: kind === 'state' });
  const districts = trpc.geography.listDistricts.useQuery(
    { stateId: parentId ?? '00000000-0000-0000-0000-000000000000' },
    { enabled: kind === 'district' && !!parentId },
  );
  const cities = trpc.geography.listCities.useQuery(
    { districtId: parentId ?? '00000000-0000-0000-0000-000000000000' },
    { enabled: kind === 'city' && !!parentId },
  );
  const rows = kind === 'state' ? (states.data ?? []) : kind === 'district' ? (districts.data ?? []) : (cities.data ?? []);
  const loading = kind === 'state' ? states.isLoading : kind === 'district' ? districts.isLoading : cities.isLoading;

  const [search, setSearch] = useState('');
  const [popupOpen, setPopupOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [gstStateCode, setGstStateCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [added, setAdded] = useState<Array<{ value: string; label: string }>>([]);

  const createState = trpc.geography.createState.useMutation();
  const createDistrict = trpc.geography.createDistrict.useMutation();
  const createCity = trpc.geography.createCity.useMutation();
  const saving = createState.isPending || createDistrict.isPending || createCity.isPending;

  const options = rows.map((row) => ({ value: row.id, label: row.name }));
  for (const extra of added) {
    if (!options.some((option) => option.value === extra.value)) options.push(extra);
  }

  function openPopup() {
    if (blocked) return;
    const text = search.trim();
    setName(text);
    setCode(suggestCode(text).slice(0, 20));
    setGstStateCode('');
    setCodeEdited(false);
    setPopupOpen(true);
  }

  function onF2(event: { key: string; preventDefault: () => void; stopPropagation: () => void }) {
    if (event.key !== 'F2') return;
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
      const created =
        kind === 'state'
          ? await createState.mutateAsync({ name: nextName, code: code.trim(), gstStateCode: gstStateCode.trim() })
          : kind === 'district'
            ? await createDistrict.mutateAsync({ stateId: parentId ?? '', name: nextName })
            : await createCity.mutateAsync({ districtId: parentId ?? '', name: nextName });
      if (kind === 'state') await utils.geography.listStates.invalidate();
      if (kind === 'district' && parentId) await utils.geography.listDistricts.invalidate({ stateId: parentId });
      if (kind === 'city' && parentId) await utils.geography.listCities.invalidate({ districtId: parentId });
      message.success(`${label[0]?.toUpperCase() ?? ''}${label.slice(1)} added.`);
      setAdded((current) => [...current, { value: created.id, label: nextName }]);
      onChange?.(created.id);
      setPopupOpen(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not add this value.');
    }
  }

  return (
    <div className={className ?? 'w-full'} onKeyDownCapture={onF2}>
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        loading={loading}
        options={options}
        onSearch={setSearch}
        onInputKeyDown={onF2}
        {...(placeholder ? { placeholder } : {})}
        {...(blocked ? { disabled: true } : {})}
        {...(allowClear ? { allowClear: true } : {})}
        value={value ?? null}
        onChange={(next: string | null | undefined) => {
          onChange?.(next ?? undefined);
        }}
        dropdownRender={(menu) => (
          <>
            {menu}
            <div className="border-t border-ui px-3 py-1.5 text-[11px] text-muted">Press F2 to add a new {label}</div>
          </>
        )}
      />
      <Modal
        open={popupOpen}
        title={canManage ? `Add ${label}` : 'Not allowed'}
        onCancel={() => setPopupOpen(false)}
        okText={canManage ? 'Save' : 'Close'}
        confirmLoading={canManage && saving}
        {...(!canManage ? { cancelButtonProps: { style: { display: 'none' as const } } } : {})}
        onOk={() => {
          if (canManage) void save();
          else setPopupOpen(false);
        }}
        destroyOnHidden
      >
        {me.isSuccess && !canManage ? <p className="m-0 text-[13.5px] text-ink">Not allowed. Contact administration.</p> : null}
        {canManage ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Name
              <Input
                value={name}
                autoFocus
                maxLength={200}
                onChange={(event) => {
                  const next = event.target.value;
                  setName(next);
                  if (kind === 'state' && !codeEdited) setCode(suggestCode(next).slice(0, 20));
                }}
              />
            </label>
            {kind === 'state' ? (
              <>
                <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                  Code
                  <Input
                    value={code}
                    maxLength={20}
                    onChange={(event) => {
                      setCodeEdited(true);
                      setCode(event.target.value.toUpperCase());
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                  GST state code
                  <Input value={gstStateCode} maxLength={10} onChange={(event) => setGstStateCode(event.target.value)} />
                </label>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
