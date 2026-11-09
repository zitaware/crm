'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { App, Button, Form, Input, Modal, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { GeographySelect } from '@/components/master-select';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatDate } from '@/lib/format';

interface VendorRow {
  id: string;
  name: string;
  shortCode: string | null;
  gstin: string | null;
  panNumber: string | null;
  paymentTerms: 'ADVANCE' | 'NET_15' | 'NET_30' | 'NET_45' | null;
  stateId: string | null;
  stateName: string | null;
  cityId: string | null;
  cityName: string | null;
  isActive: boolean;
  createdAt: string;
  version: number;
}

interface DuplicateMatch {
  partyId: string;
  name: string;
  gstin: string | null;
  panNumber: string | null;
  cityName: string | null;
  matchType: 'EXACT_GSTIN' | 'EXACT_PAN' | 'NAME_CITY';
  hasVendorProfile: boolean;
}

const PAYMENT_TERMS_OPTIONS = [
  { value: 'ADVANCE', label: 'Advance' },
  { value: 'NET_15', label: 'Net 15' },
  { value: 'NET_30', label: 'Net 30' },
  { value: 'NET_45', label: 'Net 45' },
];

function paymentTermsLabel(v: VendorRow['paymentTerms']): string {
  return PAYMENT_TERMS_OPTIONS.find((o) => o.value === v)?.label ?? '—';
}

interface FormValues {
  name: string;
  shortCode?: string;
  gstin?: string;
  panNumber?: string;
  paymentTerms?: 'ADVANCE' | 'NET_15' | 'NET_30' | 'NET_45';
  stateId?: string;
  cityId?: string;
  pinCode?: string;
  officeAddress?: string;
  internalNote?: string;
}

const EMPTY_FORM: FormValues = { name: '' };

/** Matches master-vendor.html's own "Add Vendor" form exactly: a compact
 * multi-column card, not a drawer — reused as-is inside the Edit drawer
 * too, since the field set is identical. Only a State picker is offered
 * here (not the full State->District->City cascade Client uses) — the
 * mockup itself shows only a flat City field; keeping this to State avoids
 * faking a City list with no District step to drive it. */
function VendorFormFields() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Form.Item label="Vendor name" name="name" className="md:col-span-2" rules={[{ required: true, message: 'Vendor name is required.' }, { max: 200 }]}>
        <Input placeholder="e.g. Dell India" />
      </Form.Item>
      <Form.Item label="GSTIN" name="gstin" rules={[{ max: 20 }]}>
        <Input placeholder="24ABCDE1234F1Z5" style={{ textTransform: 'uppercase' }} />
      </Form.Item>
      <Form.Item label="PAN" name="panNumber" rules={[{ max: 15 }]}>
        <Input placeholder="ABCDE1234F" style={{ textTransform: 'uppercase' }} />
      </Form.Item>
      <Form.Item label="State" name="stateId">
        <GeographySelect kind="state" allowClear placeholder="Select state" />
      </Form.Item>
      <Form.Item label="Payment terms" name="paymentTerms">
        <Select allowClear placeholder="Select terms" options={PAYMENT_TERMS_OPTIONS} />
      </Form.Item>
      <Form.Item label="Office address" name="officeAddress" className="md:col-span-2">
        <Input placeholder="Office address" />
      </Form.Item>
    </div>
  );
}

function DuplicateMatchesModal({
  open,
  matches,
  onClose,
  onUseExisting,
  loading,
}: {
  open: boolean;
  matches: DuplicateMatch[];
  onClose: () => void;
  onUseExisting: (partyId: string) => void;
  loading: boolean;
}) {
  const hardMatches = matches.filter((m) => m.matchType !== 'NAME_CITY');
  return (
    <Modal title="Possible duplicate vendor" open={open} onCancel={onClose} footer={<Button onClick={onClose}>Cancel</Button>}>
      <p className="mb-3 text-muted">A vendor identity already matches what you entered:</p>
      <div className="flex flex-col gap-2">
        {hardMatches.map((m) => (
          <div key={m.partyId} className="flex items-center justify-between rounded-ui border border-ui p-3">
            <div>
              <div className="font-medium text-ink">{m.name}</div>
              <div className="text-[12px] text-muted">
                {m.matchType === 'EXACT_GSTIN' ? `GSTIN ${m.gstin}` : `PAN ${m.panNumber}`}
                {m.cityName ? ` · ${m.cityName}` : ''}
              </div>
            </div>
            {m.hasVendorProfile ? (
              <span className="text-[12px] text-negative">Already a vendor</span>
            ) : (
              <Button size="small" type="primary" loading={loading} onClick={() => onUseExisting(m.partyId)}>
                Use this party
              </Button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default function VendorsPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('vendor.manage');

  const utils = trpc.useUtils();
  const list = trpc.vendors.list.useQuery({ includeInactive: true });

  // Opened from the top-bar search (?search=…): the list starts filtered to that match.
  const linkedSearch = useSearchParams().get('search') ?? '';
  const [search, setSearch] = useState(linkedSearch);
  const [shownLink, setShownLink] = useState(linkedSearch);
  if (linkedSearch !== shownLink) {
    setShownLink(linkedSearch);
    setSearch(linkedSearch);
  }
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [addForm] = Form.useForm<FormValues>();
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[]>([]);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm] = Form.useForm<FormValues>();
  const editDetail = trpc.vendors.getDetail.useQuery({ id: editingId ?? '' }, { enabled: !!editingId });

  const invalidate = () => utils.vendors.list.invalidate();
  const addDraft = useFormDraft('vendor:new');
  const editDraft = useFormDraft(editingId ? `vendor:${editingId}` : 'vendor:none');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedAdd = useRef(false);
  const appliedEdit = useRef<string | null>(null);
  useEffect(() => {
    if (appliedAdd.current || addDraft.isLoading || !addDraft.payload) return;
    appliedAdd.current = true;
    addForm.setFieldsValue(addDraft.payload as Partial<FormValues>);
  }, [addDraft.isLoading, addDraft.payload, addForm]);
  useEffect(() => {
    if (!editingId || editDraft.isLoading || !editDraft.payload || appliedEdit.current === editingId) return;
    appliedEdit.current = editingId;
    editForm.setFieldsValue(editDraft.payload as Partial<FormValues>);
  }, [editingId, editDraft.isLoading, editDraft.payload, editForm]);

  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const createMutation = trpc.vendors.create.useMutation({
    onSuccess: async () => {
      message.success('Vendor added.');
      addForm.resetFields();
      setDuplicatesOpen(false);
      setPendingValues(null);
      clearDraft.mutate({ formKey: 'vendor:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.vendors.update.useMutation({
    onSuccess: async () => {
      message.success('Vendor updated.');
      if (editingId) clearDraft.mutate({ formKey: `vendor:${editingId}` });
      setEditingId(null);
      await invalidate();
      await utils.vendors.getDetail.invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.vendors.setActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const submitCreate = (values: FormValues, existingPartyId?: string) => {
    createMutation.mutate({
      existingPartyId,
      name: values.name,
      shortCode: values.shortCode,
      gstin: values.gstin,
      panNumber: values.panNumber,
      paymentTerms: values.paymentTerms,
      stateId: values.stateId,
      cityId: values.cityId,
      pinCode: values.pinCode,
      officeAddress: values.officeAddress,
      internalNote: values.internalNote,
    });
  };

  const handleAdd = async (values: FormValues) => {
    if (!values.gstin && !values.panNumber && !values.name.trim()) {
      submitCreate(values);
      return;
    }
    setCheckingDuplicates(true);
    try {
      const matches: DuplicateMatch[] = await utils.vendors.checkForDuplicates.fetch({
        name: values.name,
        gstin: values.gstin,
        panNumber: values.panNumber,
        cityId: values.cityId,
      });
      const hardMatches = matches.filter((m) => m.matchType !== 'NAME_CITY');
      const softMatches = matches.filter((m) => m.matchType === 'NAME_CITY');
      if (hardMatches.length > 0) {
        setDuplicateMatches(matches);
        setPendingValues(values);
        setDuplicatesOpen(true);
        return;
      }
      if (softMatches.length > 0) {
        message.warning(`A vendor with a similar name already exists: ${softMatches[0]?.name}. Continuing to add a new one.`);
      }
      submitCreate(values);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not check for duplicates.');
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const handleUseExisting = (partyId: string) => {
    if (!pendingValues) return;
    submitCreate(pendingValues, partyId);
  };

  const openEdit = (row: VendorRow) => {
    setEditingId(row.id);
  };

  const handleEditSubmit = (values: FormValues) => {
    if (!editDetail.data) return;
    updateMutation.mutate({
      id: editDetail.data.id,
      name: values.name,
      shortCode: values.shortCode,
      gstin: values.gstin,
      panNumber: values.panNumber,
      paymentTerms: values.paymentTerms,
      stateId: values.stateId,
      cityId: values.cityId,
      pinCode: values.pinCode,
      officeAddress: values.officeAddress,
      internalNote: values.internalNote,
      expectedVersion: editDetail.data.version,
    });
  };

  const rows = (list.data ?? []) as VendorRow[];
  const filtered = rows.filter((row) => {
    if (statusFilter === 'ACTIVE' && !row.isActive) return false;
    if (statusFilter === 'INACTIVE' && row.isActive) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || (row.gstin ?? '').toLowerCase().includes(q) || (row.panNumber ?? '').toLowerCase().includes(q);
  });

  const columns: ColumnsType<VendorRow> = [
    {
      title: 'Vendor',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => openEdit(row)}>
          {v}
        </button>
      ),
    },
    { title: 'GSTIN', dataIndex: 'gstin', key: 'gstin', render: (v: string | null) => v ?? '—' },
    { title: 'PAN', dataIndex: 'panNumber', key: 'panNumber', render: (v: string | null) => v ?? '—' },
    { title: 'City', dataIndex: 'cityName', key: 'cityName', render: (v: string | null) => v ?? '—' },
    { title: 'Terms', dataIndex: 'paymentTerms', key: 'paymentTerms', render: (v: VendorRow['paymentTerms']) => paymentTermsLabel(v) },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => openEdit(row)}>
            Edit
          </Button>
          {canManage ? (
            <Popconfirm
              title={row.isActive ? 'Deactivate this vendor?' : 'Reactivate this vendor?'}
              onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
            >
              <Button size="small" danger={row.isActive}>
                {row.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Vendor Master" description="Suppliers used in purchases — GST, PAN and payment details." />

      {canManage ? (
        <UiCard title="Add Vendor" className="mb-4">
          <Form<FormValues> form={addForm} layout="vertical" initialValues={EMPTY_FORM} onFinish={handleAdd}>
            <VendorFormFields />
            <div className="flex justify-end gap-2">
              <Button onClick={() => addForm.resetFields()}>Clear</Button>
              {addDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
              <Button
                htmlType="button"
                loading={addDraft.saving}
                onClick={() => addDraft.save(addForm.getFieldsValue(true) as unknown as Record<string, unknown>)}
              >
                Save as draft
              </Button>
              <Button type="primary" htmlType="submit" loading={checkingDuplicates || createMutation.isPending}>
                Save
              </Button>
            </div>
          </Form>
        </UiCard>
      ) : null}

      {editingId && editDetail.data ? (
        <UiCard title={`Editing ${editDetail.data.name}`} className="mb-4">
          <Form<FormValues>
            key={editDetail.data.id}
            form={editForm}
            layout="vertical"
            initialValues={{
              name: editDetail.data.name,
              shortCode: editDetail.data.shortCode ?? undefined,
              gstin: editDetail.data.gstin ?? undefined,
              panNumber: editDetail.data.panNumber ?? undefined,
              paymentTerms: editDetail.data.paymentTerms ?? undefined,
              stateId: editDetail.data.stateId ?? undefined,
              cityId: editDetail.data.cityId ?? undefined,
              pinCode: editDetail.data.pinCode ?? undefined,
              officeAddress: editDetail.data.officeAddress ?? undefined,
              internalNote: editDetail.data.internalNote ?? undefined,
            }}
            onFinish={handleEditSubmit}
          >
            <VendorFormFields />
            <p className="mb-3 text-[12px] text-muted">Added {formatDate(editDetail.data.createdAt)}</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditingId(null)}>Cancel</Button>
              {editDraft.payload ? <DraftFormNote saveLabel="Save changes" /> : null}
              <Button
                htmlType="button"
                loading={editDraft.saving}
                onClick={() => editDraft.save(editForm.getFieldsValue(true) as unknown as Record<string, unknown>)}
              >
                Save as draft
              </Button>
              <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
                Save changes
              </Button>
            </div>
          </Form>
        </UiCard>
      ) : null}

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setPage(1);
              }}
            >
              Reset
            </Button>
          }
        >
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search vendor…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[220px]"
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

        <EntityTable<VendorRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load vendors. Please retry.' : undefined}
          emptyTitle="No vendors found"
          emptyDescription={canManage ? 'Use "Add Vendor" above to add one.' : undefined}
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <DuplicateMatchesModal
        open={duplicatesOpen}
        matches={duplicateMatches}
        loading={createMutation.isPending}
        onClose={() => setDuplicatesOpen(false)}
        onUseExisting={handleUseExisting}
      />
    </>
  );
}
