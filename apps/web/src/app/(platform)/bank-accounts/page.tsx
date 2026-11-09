'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Drawer, Form, Input, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { BankAccountFields, bankAccountCreateInput, type BankAccountFormValues } from '@/components/bank-account-fields';

interface BankAccountRow {
  id: string;
  legalEntityId: string;
  ledgerAccountId: string;
  ledgerAccountCode: string;
  ledgerAccountName: string;
  accountName: string;
  bankName: string | null;
  maskedAccountNumber: string | null;
  invoiceAccountNumber: string | null;
  ifsc: string | null;
  isActive: boolean;
  version: number;
}

type FormValues = BankAccountFormValues;

const PAGE_SIZE = 25;

export default function BankAccountsPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('legal_entity.manage');

  const utils = trpc.useUtils();
  const list = trpc.legalEntities.listBankAccounts.useQuery({ includeInactive: true });
  const legalEntities = trpc.legalEntities.list.useQuery();
  const legalEntityNameById = useMemo(() => new Map((legalEntities.data ?? []).map((e) => [e.id, e.legalName])), [legalEntities.data]);

  const [search, setSearch] = useState('');
  const [legalEntityFilter, setLegalEntityFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccountRow | null>(null);
  const [form] = Form.useForm<FormValues>();
  const formKey = editing ? `bank-account:${editing.id}` : 'bank-account:new';
  const formDraft = useFormDraft(drawerOpen ? formKey : 'bank-account:closed');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    const token = `${drawerOpen}:${formKey}`;
    if (!drawerOpen || formDraft.isLoading || appliedDraft.current === token) return;
    appliedDraft.current = token;
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as unknown as FormValues);
  }, [drawerOpen, formKey, formDraft.isLoading, formDraft.payload, form]);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as BankAccountRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (legalEntityFilter && row.legalEntityId !== legalEntityFilter) return false;
      if (!q) return true;
      return (
        row.accountName.toLowerCase().includes(q) ||
        (row.bankName ?? '').toLowerCase().includes(q) ||
        (row.maskedAccountNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [list.data, search, legalEntityFilter]);

  const invalidate = async () => utils.legalEntities.listBankAccounts.invalidate();

  const createMutation = trpc.legalEntities.createBankAccount.useMutation({
    onSuccess: async () => {
      message.success('Bank account added.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'bank-account:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.legalEntities.updateBankAccount.useMutation({
    onSuccess: async () => {
      message.success('Bank account updated.');
      setDrawerOpen(false);
      if (editing) clearDraft.mutate({ formKey: `bank-account:${editing.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.legalEntities.setBankAccountActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };
  const openEdit = (row: BankAccountRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      legalEntityId: row.legalEntityId,
      accountName: row.accountName,
      ...(row.bankName != null ? { bankName: row.bankName } : {}),
      ...(row.invoiceAccountNumber != null ? { invoiceAccountNumber: row.invoiceAccountNumber } : {}),
      ...(row.ifsc != null ? { ifsc: row.ifsc } : {}),
    });
    setDrawerOpen(true);
  };
  const onFinish = (values: FormValues) => {
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        accountName: values.accountName,
        bankName: values.bankName?.trim() || null,
        invoiceAccountNumber: values.invoiceAccountNumber?.trim() || null,
        ifsc: values.ifsc?.trim() || null,
        expectedVersion: editing.version,
      });
    } else {
      createMutation.mutate(bankAccountCreateInput(values));
    }
  };

  const columns: ColumnsType<BankAccountRow> = [
    { title: 'Account Name', dataIndex: 'accountName', key: 'accountName', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Bank', dataIndex: 'bankName', key: 'bankName', render: (v: string | null) => v ?? '—' },
    { title: 'Account No.', dataIndex: 'maskedAccountNumber', key: 'maskedAccountNumber', render: (_v: string | null, row: BankAccountRow) => row.invoiceAccountNumber || row.maskedAccountNumber || '—' },
    { title: 'IFSC', dataIndex: 'ifsc', key: 'ifsc', render: (v: string | null) => v ?? '—' },
    { title: 'Legal Entity', key: 'legalEntity', render: (_v, row) => legalEntityNameById.get(row.legalEntityId) ?? '—' },
    { title: 'Ledger Account', key: 'ledgerAccount', render: (_v, row) => `${row.ledgerAccountName} (${row.ledgerAccountCode})` },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 110, render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} /> },
  ];
  if (canManage) {
    columns.push({
      title: '',
      key: 'actions',
      width: 190,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => openEdit(row)}>
            Edit
          </Button>
          <Popconfirm
            title={row.isActive ? 'Deactivate this bank account?' : 'Reactivate this bank account?'}
            onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
          >
            <Button size="small" danger={row.isActive}>
              {row.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </Popconfirm>
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Bank Accounts"
        description="Bank accounts receipts and payments are recorded against, one per legal entity's Chart of Accounts ledger account."
        actions={
          canManage ? (
            <Button type="primary" onClick={openCreate}>
              Add Bank Account
            </Button>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard>
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search bank accounts…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[240px]"
            />
          </FilterField>
          <FilterField label="Legal entity">
            <Select
              allowClear
              placeholder="All"
              value={legalEntityFilter}
              onChange={(v) => {
                setLegalEntityFilter(v);
                setPage(1);
              }}
              className="w-[220px]"
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<BankAccountRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load bank accounts. Please retry.' : undefined}
          emptyTitle="No bank accounts found"
          emptyDescription={canManage ? 'Use "Add Bank Account" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Drawer open={drawerOpen} title={editing ? 'Edit Bank Account' : 'Add Bank Account'} onClose={() => setDrawerOpen(false)} width={480} destroyOnHidden>
        <Form<FormValues> form={form} layout="vertical" requiredMark onFinish={onFinish}>
          <BankAccountFields lockLegalEntity={!!editing} editing={editing} />

          <Form.Item className="mb-0 mt-2">
            <div className="flex justify-end gap-[10px]">
              <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
              {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
              <Button
                htmlType="button"
                loading={formDraft.saving}
                onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
              >
                Save as draft
              </Button>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending || updateMutation.isPending}>
                {editing ? 'Save changes' : 'Save'}
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
