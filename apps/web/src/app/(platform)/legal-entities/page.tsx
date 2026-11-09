'use client';

import { useMemo, useState } from 'react';
import { App, Button, Drawer, Form, Input, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { FormSaveButtons, useApplyFormDraft, useFormDraft } from '@/components/form-draft';
import { GstRegistrationFields, gstRegistrationCreateInput, type GstRegistrationFormValues } from '@/components/gst-registration-fields';
import { LegalEntityFields, legalEntityCreateInput, type ImageDraft, type LegalEntityCoreValues as CoreFormValues } from '@/components/legal-entity-fields';
import { ClaimApproversCell } from './claim-approvers';
import { EntityLogo } from './entity-logo';

interface LegalEntityRow {
  id: string;
  legalName: string;
  panNumber: string;
  registeredAddress: string;
  hasLogo: boolean;
  isActive: boolean;
  version: number;
}

interface GstRegistrationRow {
  id: string;
  legalEntityId: string;
  stateId: string;
  gstin: string;
  tradeName: string | null;
  isActive: boolean;
  version: number;
}

const PAGE_SIZE = 25;

function GstRegistrationsSection({ legalEntityId }: { legalEntityId: string }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const list = trpc.legalEntities.listGstRegistrations.useQuery({ legalEntityId });
  const states = trpc.geography.listStates.useQuery();
  const stateNameById = useMemo(() => new Map((states.data ?? []).map((s) => [s.id, s.name])), [states.data]);

  const [addFormOpen, setAddFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tradeNameDraft, setTradeNameDraft] = useState('');
  const [form] = Form.useForm<GstRegistrationFormValues>();

  const invalidate = async () => utils.legalEntities.listGstRegistrations.invalidate({ legalEntityId });

  const createMutation = trpc.legalEntities.createGstRegistration.useMutation({
    onSuccess: async () => {
      message.success('GST registration added.');
      setAddFormOpen(false);
      form.resetFields();
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.legalEntities.updateGstRegistration.useMutation({
    onSuccess: async () => {
      message.success('Trade name updated.');
      setEditingId(null);
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.legalEntities.setGstRegistrationActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });
  const deleteMutation = trpc.legalEntities.deleteGstRegistration.useMutation({
    onSuccess: async () => {
      message.success('GST registration deleted.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const rows = (list.data ?? []) as GstRegistrationRow[];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h5 className="text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">GST Registrations</h5>
        {!addFormOpen ? (
          <Button size="small" onClick={() => setAddFormOpen(true)}>
            Add GST Registration
          </Button>
        ) : null}
      </div>

      {addFormOpen ? (
        <Form<GstRegistrationFormValues>
          form={form}
          layout="vertical"
          requiredMark
          onFinish={(values) => createMutation.mutate(gstRegistrationCreateInput(legalEntityId, values))}
        >
          <GstRegistrationFields />
          <div className="flex justify-end gap-2">
            <Button
              size="small"
              onClick={() => {
                setAddFormOpen(false);
                form.resetFields();
              }}
            >
              Cancel
            </Button>
            <Button size="small" type="primary" htmlType="submit" loading={createMutation.isPending}>
              Add
            </Button>
          </div>
        </Form>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        {rows.length === 0 && !list.isLoading ? <p className="text-[13px] text-muted-2">No GST registrations yet.</p> : null}
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-1 rounded-ui border border-ui bg-ui-2 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12.5px] text-text">{row.gstin}</span>
              <StatusTag status={row.isActive ? 'ACTIVE' : 'INACTIVE'} />
            </div>
            <span className="text-[12.5px] text-muted">{stateNameById.get(row.stateId) ?? '—'}</span>
            {editingId === row.id ? (
              <div className="flex gap-2">
                <Input
                  size="small"
                  value={tradeNameDraft}
                  onChange={(e) => setTradeNameDraft(e.target.value)}
                  placeholder="Trade name"
                />
                <Button size="small" onClick={() => setEditingId(null)}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({
                      id: row.id,
                      tradeName: tradeNameDraft || undefined,
                      expectedVersion: row.version,
                    })
                  }
                >
                  Save
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-muted">{row.tradeName ?? '—'}</span>
                <div className="flex gap-2">
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingId(row.id);
                      setTradeNameDraft(row.tradeName ?? '');
                    }}
                  >
                    Rename
                  </Button>
                  <Popconfirm
                    title={row.isActive ? 'Deactivate this registration?' : 'Reactivate this registration?'}
                    onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
                  >
                    <Button size="small" danger={row.isActive}>
                      {row.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="Delete this GST registration? This frees the GSTIN for reuse and cannot be undone."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => deleteMutation.mutate({ id: row.id, expectedVersion: row.version })}
                  >
                    <Button size="small" danger loading={deleteMutation.isPending}>
                      Delete
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LegalEntityFormBody({
  mode,
  entityId,
  initial,
  onSubmit,
  onCancel,
  submitting,
  gstSection,
}: {
  mode: 'create' | 'edit';
  entityId: string | null;
  initial: { legalName: string; panNumber: string; registeredAddress: string };
  onSubmit: (
    values: CoreFormValues,
    images: { logo: ImageDraft; seal: ImageDraft; authorizedSign: ImageDraft },
  ) => void;
  onCancel: () => void;
  submitting: boolean;
  gstSection: React.ReactNode | null;
}) {
  const formKey = mode === 'create' || !entityId ? 'legal-entity:new' : `legal-entity:${entityId}`;
  const formDraft = useFormDraft(formKey);
  const branding = trpc.legalEntities.getBranding.useQuery({ id: entityId ?? '' }, { enabled: mode === 'edit' && !!entityId });
  const printReady = mode === 'create' || branding.isSuccess || branding.isError;
  if (!printReady) {
    return <p className="text-[13px] text-muted">Loading…</p>;
  }
  return (
    <LegalEntityFormReady
      mode={mode}
      formDraft={formDraft}
      branding={branding.data}
      initial={initial}
      onSubmit={onSubmit}
      onCancel={onCancel}
      submitting={submitting}
      gstSection={gstSection}
    />
  );
}

function imageFromDraft(payload: Record<string, unknown> | null, key: 'logo' | 'seal' | 'authorizedSign'): ImageDraft {
  if (!payload || !(key in payload)) return undefined;
  return payload[key] as ImageDraft;
}

function LegalEntityFormReady({
  mode,
  formDraft,
  branding,
  initial,
  onSubmit,
  onCancel,
  submitting,
  gstSection,
}: {
  mode: 'create' | 'edit';
  formDraft: ReturnType<typeof useFormDraft>;
  branding:
    | {
        placeOfSupply?: string | null;
        jurisdiction?: string | null;
        stateCode?: string | null;
        logo?: ImageDraft;
        seal?: ImageDraft;
        authorizedSign?: ImageDraft;
      }
    | undefined;
  initial: { legalName: string; panNumber: string; registeredAddress: string };
  onSubmit: (
    values: CoreFormValues,
    images: { logo: ImageDraft; seal: ImageDraft; authorizedSign: ImageDraft },
  ) => void;
  onCancel: () => void;
  submitting: boolean;
  gstSection: React.ReactNode | null;
}) {
  const [form] = Form.useForm<CoreFormValues>();
  const [logo, setLogo] = useState<ImageDraft>(() => imageFromDraft(formDraft.payload, 'logo'));
  const [seal, setSeal] = useState<ImageDraft>(() => imageFromDraft(formDraft.payload, 'seal'));
  const [authorizedSign, setAuthorizedSign] = useState<ImageDraft>(() => imageFromDraft(formDraft.payload, 'authorizedSign'));
  const [imagesApplied, setImagesApplied] = useState(formDraft.payload != null);
  if (!imagesApplied && formDraft.payload) {
    setImagesApplied(true);
    if ('logo' in formDraft.payload) setLogo(formDraft.payload.logo as ImageDraft);
    if ('seal' in formDraft.payload) setSeal(formDraft.payload.seal as ImageDraft);
    if ('authorizedSign' in formDraft.payload) setAuthorizedSign(formDraft.payload.authorizedSign as ImageDraft);
  }
  useApplyFormDraft(form, formDraft.payload, (payload) =>
    Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'logo' && key !== 'seal' && key !== 'authorizedSign')),
  );

  return (
    <div className="flex flex-col gap-6">
      <Form<CoreFormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{
          ...initial,
          placeOfSupply: branding?.placeOfSupply ?? '',
          jurisdiction: branding?.jurisdiction ?? '',
          stateCode: branding?.stateCode ?? '',
        }}
        onFinish={(values) => onSubmit(values, { logo, seal, authorizedSign })}
      >
        <LegalEntityFields
          mode={mode}
          saved={branding}
          images={{ logo, seal, authorizedSign }}
          onImagesChange={(next) => {
            setLogo(next.logo);
            setSeal(next.seal);
            setAuthorizedSign(next.authorizedSign);
          }}
        />

        <Form.Item className="mt-2 mb-0">
          <FormSaveButtons
            onCancel={onCancel}
            submitting={submitting || formDraft.saving}
            saveLabel={mode === 'create' ? 'Save' : 'Save changes'}
            drafted={formDraft.payload != null}
            onDraft={() =>
              formDraft.save({
                ...(form.getFieldsValue(true) as unknown as Record<string, unknown>),
                logo,
                seal,
                authorizedSign,
              })
            }
          />
        </Form.Item>
      </Form>

      {gstSection}
    </div>
  );
}

export default function LegalEntitiesPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('legal_entity.manage');

  const utils = trpc.useUtils();
  const list = trpc.legalEntities.list.useQuery({ includeInactive: true });
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<LegalEntityRow | null>(null);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as LegalEntityRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === 'ACTIVE' && !row.isActive) return false;
      if (statusFilter === 'INACTIVE' && row.isActive) return false;
      if (!q) return true;
      return row.legalName.toLowerCase().includes(q) || row.panNumber.toLowerCase().includes(q);
    });
  }, [list.data, search, statusFilter]);

  const invalidate = async () => await utils.legalEntities.list.invalidate();

  const rememberBranding = (
    id: string,
    images: { logo?: ImageDraft; seal?: ImageDraft; authorizedSign?: ImageDraft },
    print: { placeOfSupply?: string | undefined; jurisdiction?: string | undefined; stateCode?: string | undefined },
  ) => {
    const text = (value: string | undefined) => {
      const trimmed = value?.trim() ?? '';
      return trimmed.length === 0 ? null : trimmed;
    };
    utils.legalEntities.getBranding.setData({ id }, (current) => ({
      logo: images.logo !== undefined ? images.logo : (current?.logo ?? null),
      seal: images.seal !== undefined ? images.seal : (current?.seal ?? null),
      authorizedSign: images.authorizedSign !== undefined ? images.authorizedSign : (current?.authorizedSign ?? null),
      placeOfSupply: print.placeOfSupply !== undefined ? text(print.placeOfSupply) : (current?.placeOfSupply ?? null),
      jurisdiction: print.jurisdiction !== undefined ? text(print.jurisdiction) : (current?.jurisdiction ?? null),
      stateCode: print.stateCode !== undefined ? text(print.stateCode) : (current?.stateCode ?? null),
    }));
  };

  const createMutation = trpc.legalEntities.create.useMutation({
    onSuccess: async (created, variables) => {
      rememberBranding(created.id, variables, variables);
      message.success('Legal entity added.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'legal-entity:new' });
      await invalidate();
      await utils.legalEntities.getBranding.invalidate({ id: created.id });
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.legalEntities.update.useMutation({
    onSuccess: async (_updated, variables) => {
      rememberBranding(variables.id, variables, variables);
      message.success('Legal entity updated.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: `legal-entity:${variables.id}` });
      await invalidate();
      await utils.legalEntities.getBranding.invalidate({ id: variables.id });
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.legalEntities.setActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });
  const deleteMutation = trpc.legalEntities.delete.useMutation({
    onSuccess: async () => {
      message.success('Legal entity deleted.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditingRow(null);
    setDrawerOpen(true);
  };
  const openEdit = (row: LegalEntityRow) => {
    setEditingRow(row);
    setDrawerOpen(true);
  };

  const handleSubmit = (
    values: CoreFormValues,
    images: { logo: ImageDraft; seal: ImageDraft; authorizedSign: ImageDraft },
  ) => {
    if (!editingRow) {
      createMutation.mutate(legalEntityCreateInput(values, images));
      return;
    }
    updateMutation.mutate({
      id: editingRow.id,
      legalName: values.legalName,
      registeredAddress: values.registeredAddress,
      placeOfSupply: values.placeOfSupply ?? '',
      jurisdiction: values.jurisdiction ?? '',
      stateCode: values.stateCode ?? '',
      expectedVersion: editingRow.version,
      ...(images.logo !== undefined ? { logo: images.logo } : {}),
      ...(images.seal !== undefined ? { seal: images.seal } : {}),
      ...(images.authorizedSign !== undefined ? { authorizedSign: images.authorizedSign } : {}),
    });
  };

  const columns: ColumnsType<LegalEntityRow> = [
    {
      title: 'Legal Name',
      dataIndex: 'legalName',
      key: 'legalName',
      render: (v: string, row) => (
        <span className="flex items-center gap-3">
          <EntityLogo legalEntityId={row.id} legalName={v} hasLogo={row.hasLogo} />
          <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => openEdit(row)}>
            {v}
          </button>
        </span>
      ),
    },
    { title: 'PAN', dataIndex: 'panNumber', key: 'panNumber', width: 120, render: (v: string) => <span className="font-mono text-[12.5px] text-muted">{v}</span> },
    { title: 'Registered Address', dataIndex: 'registeredAddress', key: 'registeredAddress' },
    { title: 'Expense claim approvers', key: 'claimApprovers', render: (_v, row) => <ClaimApproversCell legalEntityId={row.id} /> },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 110, render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      title: '',
      key: 'actions',
      width: 250,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => openEdit(row)}>
            Edit
          </Button>
          {canManage ? (
            <Popconfirm
              title={row.isActive ? 'Deactivate this legal entity?' : 'Reactivate this legal entity?'}
              onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
            >
              <Button size="small" danger={row.isActive}>
                {row.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </Popconfirm>
          ) : null}
          {canManage ? (
            <Popconfirm
              title="Delete this legal entity? This frees its PAN for reuse and cannot be undone. Blocked if it still has GST registrations or financial years."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteMutation.mutate({ id: row.id, expectedVersion: row.version })}
            >
              <Button size="small" danger loading={deleteMutation.isPending}>
                Delete
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Legal Entities"
        description="Your own legal entities and their GST registrations. Logo, seal, and authorized sign print on invoices. Bank accounts are managed separately."
        actions={
          canManage ? (
            <Button type="primary" onClick={openCreate}>
              Add Legal Entity
            </Button>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard>
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search legal entities…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[240px]"
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              className="w-[140px]"
              options={[
                { value: 'all', label: 'All' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<LegalEntityRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load legal entities. Please retry.' : undefined}
          emptyTitle="No legal entities found"
          emptyDescription={canManage ? 'Use "Add Legal Entity" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Drawer open={drawerOpen} title={editingRow ? 'Edit Legal Entity' : 'Add Legal Entity'} onClose={() => setDrawerOpen(false)} width={480} destroyOnHidden>
        <LegalEntityFormBody
          key={editingRow?.id ?? 'create'}
          mode={editingRow ? 'edit' : 'create'}
          entityId={editingRow?.id ?? null}
          initial={
            editingRow
              ? { legalName: editingRow.legalName, panNumber: editingRow.panNumber, registeredAddress: editingRow.registeredAddress }
              : { legalName: '', panNumber: '', registeredAddress: '' }
          }
          onSubmit={handleSubmit}
          onCancel={() => setDrawerOpen(false)}
          submitting={createMutation.isPending || updateMutation.isPending}
          gstSection={editingRow ? <GstRegistrationsSection legalEntityId={editingRow.id} /> : null}
        />
      </Drawer>
    </>
  );
}
