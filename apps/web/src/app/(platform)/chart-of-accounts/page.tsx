'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Drawer, Form, Input, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import type { LedgerLinkedAccount } from '@zitaware/contracts';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { LedgerAccountFields, ledgerAccountCreateInput, normalizeCode, type LedgerAccountFormValues } from '@/components/ledger-account-fields';

interface GroupRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountType: string;
  normalBalance: string;
  parentGroupId: string | null;
  parentGroupName: string | null;
  isSystemDefined: boolean;
  isActive: boolean;
  version: number;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  accountGroupId: string;
  accountGroupName: string;
  accountType: string;
  normalBalance: string;
  allowManualPosting: boolean;
  isActive: boolean;
  version: number;
  linkedAccounts: LedgerLinkedAccount[];
}

/** One line per bank account or credit card posting to this ledger: what it is and where. */
function linkedLine(a: LedgerLinkedAccount): string {
  return [a.kind === 'CREDIT_CARD' ? 'Credit card' : a.bankName ?? 'Bank account', a.number, a.ifsc ? `IFSC ${a.ifsc}` : null, a.legalEntityName, a.isActive ? null : 'inactive']
    .filter(Boolean)
    .join(' · ');
}

interface GroupFormValues {
  code: string;
  name: string;
  description: string | undefined;
  parentGroupId: string | undefined;
}

type AccountFormValues = LedgerAccountFormValues;

/** Every group descended from `rootId` (inclusive) — computed client-side
 * from the already-fetched flat list, so the parent selector can exclude
 * a group and its own descendants and never offer a choice that would
 * create a cycle. */
function collectDescendants(rootId: string, rows: GroupRow[]): Set<string> {
  const excluded = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parentGroupId && excluded.has(row.parentGroupId) && !excluded.has(row.id)) {
        excluded.add(row.id);
        changed = true;
      }
    }
  }
  return excluded;
}

export default function ChartOfAccountsPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('chart_of_account.manage');
  const canReadJournal = (me.data?.permissions ?? []).includes('journal.read');

  const utils = trpc.useUtils();
  const groups = trpc.chartOfAccounts.listGroups.useQuery({ includeInactive: true });
  const accounts = trpc.chartOfAccounts.listAccounts.useQuery({ includeInactive: true });

  const groupRows = useMemo(() => (groups.data ?? []) as GroupRow[], [groups.data]);
  const accountRows = useMemo(() => (accounts.data ?? []) as AccountRow[], [accounts.data]);

  const invalidateGroups = () => utils.chartOfAccounts.listGroups.invalidate();
  const invalidateAccounts = () => utils.chartOfAccounts.listAccounts.invalidate();

  // ---------------------------------------------------------------- Groups
  const [groupStatus, setGroupStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupRow | null>(null);
  const [groupForm] = Form.useForm<GroupFormValues>();
  const groupKey = editingGroup ? `account-group:${editingGroup.id}` : 'account-group:new';
  const groupDraft = useFormDraft(groupDrawerOpen ? groupKey : 'account-group:closed');
  const clearGroupDraft = trpc.formDrafts.clear.useMutation();
  const appliedGroup = useRef('');
  useEffect(() => {
    const token = `${groupDrawerOpen}:${groupKey}`;
    if (!groupDrawerOpen || groupDraft.isLoading || appliedGroup.current === token) return;
    appliedGroup.current = token;
    if (groupDraft.payload) groupForm.setFieldsValue(groupDraft.payload as unknown as GroupFormValues);
  }, [groupDrawerOpen, groupKey, groupDraft.isLoading, groupDraft.payload, groupForm]);
  const watchedParentGroupId = Form.useWatch('parentGroupId', groupForm);

  const filteredGroups = useMemo(
    () =>
      groupRows.filter((row) => {
        if (groupStatus === 'active') return row.isActive;
        if (groupStatus === 'inactive') return !row.isActive;
        return true;
      }),
    [groupRows, groupStatus],
  );

  const excludedParentIds = useMemo(
    () => (editingGroup ? collectDescendants(editingGroup.id, groupRows) : new Set<string>()),
    [editingGroup, groupRows],
  );
  const parentGroupOptions = groupRows
    .filter((row) => row.isActive && !excludedParentIds.has(row.id))
    .map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }));

  const derivedParent = editingGroup?.isSystemDefined
    ? editingGroup
    : groupRows.find((row) => row.id === watchedParentGroupId);

  const createGroupMutation = trpc.chartOfAccounts.createGroup.useMutation({
    onSuccess: async () => {
      message.success('Account group created.');
      setGroupDrawerOpen(false);
      clearGroupDraft.mutate({ formKey: 'account-group:new' });
      groupForm.resetFields();
      await invalidateGroups();
    },
    onError: (error) => message.error(error.message),
  });
  const updateGroupMutation = trpc.chartOfAccounts.updateGroup.useMutation({
    onSuccess: async () => {
      message.success('Account group updated.');
      setGroupDrawerOpen(false);
      await invalidateGroups();
    },
    onError: (error) => message.error(error.message),
  });
  const setGroupActiveMutation = trpc.chartOfAccounts.setGroupActive.useMutation({
    onSuccess: async () => {
      message.success('Account group updated.');
      await invalidateGroups();
    },
    onError: (error) => message.error(error.message),
  });

  const openCreateGroup = () => {
    setEditingGroup(null);
    groupForm.resetFields();
    setGroupDrawerOpen(true);
  };
  const openEditGroup = (row: GroupRow) => {
    setEditingGroup(row);
    groupForm.setFieldsValue({
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      parentGroupId: row.parentGroupId ?? undefined,
    });
    setGroupDrawerOpen(true);
  };
  const submitGroup = (values: GroupFormValues) => {
    if (editingGroup) {
      updateGroupMutation.mutate({
        id: editingGroup.id,
        name: values.name,
        description: values.description,
        parentGroupId: editingGroup.isSystemDefined ? undefined : values.parentGroupId,
        expectedVersion: editingGroup.version,
      });
    } else {
      createGroupMutation.mutate({
        code: normalizeCode(values.code),
        name: values.name,
        description: values.description,
        parentGroupId: values.parentGroupId!,
      });
    }
  };

  const groupColumns: ColumnsType<GroupRow> = [
    { title: 'Code', dataIndex: 'code', key: 'code', width: 140 },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <span className="font-medium text-ink">
          {v}
          {row.isSystemDefined ? (
            <span className="ml-2 rounded bg-line-2 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-muted">
              System
            </span>
          ) : null}
        </span>
      ),
    },
    { title: 'Parent', dataIndex: 'parentGroupName', key: 'parentGroupName', render: (v: string | null) => v ?? '—' },
    { title: 'Account Type', dataIndex: 'accountType', key: 'accountType', width: 130 },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} label={v ? 'Active' : 'Inactive'} />,
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      align: 'right',
      render: (_v, row) =>
        canManage ? (
          <div className="flex justify-end gap-2">
            <Button size="small" onClick={() => openEditGroup(row)}>
              Edit
            </Button>
            {!row.isSystemDefined ? (
              row.isActive ? (
                <Popconfirm
                  title="Deactivate this account group?"
                  onConfirm={() =>
                    setGroupActiveMutation.mutate({ id: row.id, isActive: false, expectedVersion: row.version })
                  }
                >
                  <Button size="small" danger>
                    Deactivate
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  size="small"
                  loading={setGroupActiveMutation.isPending}
                  onClick={() => setGroupActiveMutation.mutate({ id: row.id, isActive: true, expectedVersion: row.version })}
                >
                  Reactivate
                </Button>
              )
            ) : null}
          </div>
        ) : null,
    },
  ];

  // -------------------------------------------------------------- Accounts
  const [accountGroupFilter, setAccountGroupFilter] = useState<string | undefined>(undefined);
  const [accountStatus, setAccountStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [accountForm] = Form.useForm<AccountFormValues>();
  const accountKey = editingAccount ? `ledger-account:${editingAccount.id}` : 'ledger-account:new';
  const accountDraft = useFormDraft(accountDrawerOpen ? accountKey : 'ledger-account:closed');
  const clearAccountDraft = trpc.formDrafts.clear.useMutation();
  const appliedAccount = useRef('');
  useEffect(() => {
    const token = `${accountDrawerOpen}:${accountKey}`;
    if (!accountDrawerOpen || accountDraft.isLoading || appliedAccount.current === token) return;
    appliedAccount.current = token;
    if (accountDraft.payload) accountForm.setFieldsValue(accountDraft.payload as unknown as AccountFormValues);
  }, [accountDrawerOpen, accountKey, accountDraft.isLoading, accountDraft.payload, accountForm]);

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    return accountRows.filter((row) => {
      if (accountGroupFilter && row.accountGroupId !== accountGroupFilter) return false;
      if (accountStatus === 'active' && !row.isActive) return false;
      if (accountStatus === 'inactive' && row.isActive) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
    });
  }, [accountRows, accountGroupFilter, accountStatus, accountSearch]);

  const createAccountMutation = trpc.chartOfAccounts.createAccount.useMutation({
    onSuccess: async () => {
      message.success('Ledger account created.');
      setAccountDrawerOpen(false);
      clearAccountDraft.mutate({ formKey: 'ledger-account:new' });
      accountForm.resetFields();
      await invalidateAccounts();
    },
    onError: (error) => message.error(error.message),
  });
  const updateAccountMutation = trpc.chartOfAccounts.updateAccount.useMutation({
    onSuccess: async () => {
      message.success('Ledger account updated.');
      setAccountDrawerOpen(false);
      await invalidateAccounts();
    },
    onError: (error) => message.error(error.message),
  });
  const setAccountActiveMutation = trpc.chartOfAccounts.setAccountActive.useMutation({
    onSuccess: async () => {
      message.success('Ledger account updated.');
      await invalidateAccounts();
    },
    onError: (error) => message.error(error.message),
  });

  const openCreateAccount = () => {
    setEditingAccount(null);
    accountForm.resetFields();
    accountForm.setFieldsValue({ allowManualPosting: true });
    setAccountDrawerOpen(true);
  };
  const openEditAccount = (row: AccountRow) => {
    setEditingAccount(row);
    accountForm.setFieldsValue({
      code: row.code,
      name: row.name,
      description: row.description ?? undefined,
      accountGroupId: row.accountGroupId,
      allowManualPosting: row.allowManualPosting,
    });
    setAccountDrawerOpen(true);
  };
  const submitAccount = (values: AccountFormValues) => {
    if (editingAccount) {
      updateAccountMutation.mutate({
        id: editingAccount.id,
        name: values.name,
        description: values.description,
        accountGroupId: values.accountGroupId,
        allowManualPosting: values.allowManualPosting,
        expectedVersion: editingAccount.version,
      });
    } else {
      createAccountMutation.mutate(ledgerAccountCreateInput(values));
    }
  };

  const accountColumns: ColumnsType<AccountRow> = [
    { title: 'Account Code', dataIndex: 'code', key: 'code', width: 140 },
    {
      title: 'Account Name',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <div>
          <span className="font-medium text-ink">{v}</span>
          {row.linkedAccounts.map((a) => (
            <div key={a.id} className="text-[11.5px] text-muted">
              {linkedLine(a)}
            </div>
          ))}
        </div>
      ),
    },
    { title: 'Group', dataIndex: 'accountGroupName', key: 'accountGroupName' },
    { title: 'Account Type', dataIndex: 'accountType', key: 'accountType', width: 130 },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} label={v ? 'Active' : 'Inactive'} />,
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {canReadJournal ? (
            <Button size="small" onClick={() => router.push(`/chart-of-accounts/ledger/${row.id}`)}>
              View Ledger
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button size="small" onClick={() => openEditAccount(row)}>
                Edit
              </Button>
              {row.isActive ? (
                <Popconfirm
                  title="Deactivate this ledger account?"
                  onConfirm={() =>
                    setAccountActiveMutation.mutate({ id: row.id, isActive: false, expectedVersion: row.version })
                  }
                >
                  <Button size="small" danger>
                    Deactivate
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  size="small"
                  loading={setAccountActiveMutation.isPending}
                  onClick={() => setAccountActiveMutation.mutate({ id: row.id, isActive: true, expectedVersion: row.version })}
                >
                  Reactivate
                </Button>
              )}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Chart of Accounts" description="Account groups and ledger accounts used to classify future financial transactions." />

      <UiCard
        title="Account Groups"
        className="mb-4"
        actions={canManage ? <Button onClick={openCreateGroup}>Add Group</Button> : undefined}
      >
        <div className="mb-3 flex flex-wrap items-end gap-[9px]">
          <FilterField label="Status">
            <Select
              value={groupStatus}
              onChange={setGroupStatus}
              className="w-[140px]"
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </FilterField>
        </div>
        <EntityTable<GroupRow>
          rowKey="id"
          columns={groupColumns}
          dataSource={filteredGroups}
          loading={groups.isLoading}
          errorMessage={groups.isError ? 'Could not load account groups. Please retry.' : undefined}
          emptyTitle="No account groups found"
          page={1}
          pageSize={100}
          total={filteredGroups.length}
          onPageChange={() => undefined}
        />
      </UiCard>

      <UiCard
        title="Ledger Accounts"
        flush
        actions={canManage ? <Button onClick={openCreateAccount}>Add Account</Button> : undefined}
      >
        <FilterCard>
          <FilterField label="Group">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All groups"
              value={accountGroupFilter}
              onChange={setAccountGroupFilter}
              className="w-[220px]"
              options={groupRows.map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              value={accountStatus}
              onChange={setAccountStatus}
              className="w-[140px]"
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </FilterField>
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Code or name…"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              className="w-[220px]"
            />
          </FilterField>
        </FilterCard>
        <EntityTable<AccountRow>
          rowKey="id"
          columns={accountColumns}
          dataSource={filteredAccounts}
          loading={accounts.isLoading}
          errorMessage={accounts.isError ? 'Could not load ledger accounts. Please retry.' : undefined}
          emptyTitle="No ledger accounts found"
          emptyDescription={canManage ? 'Use "Add Account" to create one.' : undefined}
          page={1}
          pageSize={100}
          total={filteredAccounts.length}
          onPageChange={() => undefined}
        />
      </UiCard>

      <Drawer
        open={groupDrawerOpen}
        title={editingGroup ? 'Edit Account Group' : 'Add Account Group'}
        onClose={() => setGroupDrawerOpen(false)}
        width={440}
        destroyOnHidden
      >
        <Form<GroupFormValues> form={groupForm} layout="vertical" requiredMark onFinish={submitGroup}>
          <Form.Item label="Code" name="code" rules={[{ required: true, message: 'Code is required.' }, { max: 50 }]}>
            <Input
              disabled={!!editingGroup}
              onBlur={(e) => groupForm.setFieldValue('code', normalizeCode(e.target.value))}
              placeholder="e.g. CURRENT_ASSETS"
            />
          </Form.Item>
          <Form.Item label="Name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 200 }]}>
            <Input />
          </Form.Item>
          {!editingGroup?.isSystemDefined ? (
            <Form.Item
              label="Parent Group"
              name="parentGroupId"
              rules={[{ required: true, message: 'A parent group is required.' }]}
>
              <Select showSearch optionFilterProp="label" placeholder="Select a parent group" options={parentGroupOptions} />
            </Form.Item>
          ) : null}
          <Form.Item label="Description" name="description" rules={[{ max: 2000 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {derivedParent ? (
            <div className="mb-4 rounded-ui border border-ui bg-paper p-3 text-[13px]">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.04em] text-muted">
                Account type &amp; normal balance (derived, read-only)
              </div>
              <div className="text-ink">
                {derivedParent.accountType} · {derivedParent.normalBalance}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-[10px]">
            {groupDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
            <Button
              htmlType="button"
              loading={groupDraft.saving}
              onClick={() => groupDraft.save(groupForm.getFieldsValue(true) as unknown as Record<string, unknown>)}
            >
              Save as draft
            </Button>
            <Button type="primary" htmlType="submit" loading={createGroupMutation.isPending || updateGroupMutation.isPending}>
              {editingGroup ? 'Save changes' : 'Save'}
            </Button>
          </div>
        </Form>
      </Drawer>

      <Drawer
        open={accountDrawerOpen}
        title={editingAccount ? 'Edit Ledger Account' : 'Add Ledger Account'}
        onClose={() => setAccountDrawerOpen(false)}
        width={440}
        destroyOnHidden
      >
        <Form<AccountFormValues> form={accountForm} layout="vertical" requiredMark onFinish={submitAccount}>
          <LedgerAccountFields mode={editingAccount ? 'edit' : 'create'} />
          <div className="flex flex-wrap justify-end gap-[10px]">
            {accountDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
            <Button
              htmlType="button"
              loading={accountDraft.saving}
              onClick={() => accountDraft.save(accountForm.getFieldsValue(true) as unknown as Record<string, unknown>)}
            >
              Save as draft
            </Button>
            <Button type="primary" htmlType="submit" loading={createAccountMutation.isPending || updateAccountMutation.isPending}>
              {editingAccount ? 'Save changes' : 'Save'}
            </Button>
          </div>
        </Form>
      </Drawer>
    </>
  );
}
