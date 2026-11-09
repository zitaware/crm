'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dayjs, { type Dayjs } from 'dayjs';
import { App, Button, Drawer, Form, Input, Popconfirm, Select, Switch, Tag } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MoneyInput, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { MasterSelect } from '@/components/master-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { FormSaveButtons, useApplyFormDraft, useFormDraft } from '@/components/form-draft';
import { formatDate, formatMoney } from '@/lib/format';
import { downloadWorkbook, ImportEmployeesModal } from './import-modal';

interface EmployeeRow {
  id: string;
  userId: string | null;
  legalEntityId: string | null;
  internalDepartmentId: string | null;
  designationId: string | null;
  employmentTypeId: string | null;
  employeeCode: string;
  fullName: string;
  isReimbursable: boolean;
  displayedSalaryAmount: string | null;
  joiningDate: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
}

interface CoreFormValues {
  employeeCode: string;
  fullName: string;
  legalEntityId?: string;
  internalDepartmentId?: string;
  designationId?: string;
  employmentTypeId?: string;
  isReimbursable: boolean;
  displayedSalaryAmount?: string;
  /** Required when adding; an imported employee may have none yet (ADR-170). */
  joiningDate?: dayjs.Dayjs;
}

interface EnableAccessFormValues {
  email: string;
  displayName: string;
  roleIds: string[];
}

const PAGE_SIZE = 25;
const DECIMAL_PATTERN = /^\d{1,15}(\.\d{1,4})?$/;

/**
 * The System Access section — shown only when editing an existing employee
 * (an id must exist before it can be linked to a user). Reuses the Users
 * backend directly (users.invite/disable/unlinkEmployee) rather than a
 * duplicate Employees-side code path, per ADR-046.
 */
function SystemAccessSection({
  employeeId,
  fullName,
  linkedUser,
  roleOptions,
  canManageUsers,
  onChanged,
}: {
  employeeId: string;
  fullName: string;
  linkedUser: { id: string; email: string; status: string; roleNames: string[] } | null;
  roleOptions: { id: string; name: string }[];
  canManageUsers: boolean;
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [enableFormOpen, setEnableFormOpen] = useState(false);
  const [form] = Form.useForm<EnableAccessFormValues>();

  const inviteMutation = trpc.users.invite.useMutation({
    onSuccess: async () => {
      message.success('System access enabled.');
      setEnableFormOpen(false);
      await onChanged();
    },
    onError: (error) => message.error(error.message),
  });
  const disableMutation = trpc.users.disable.useMutation({
    onSuccess: async () => {
      message.success('Access revoked.');
      await onChanged();
    },
    onError: (error) => message.error(error.message),
  });
  const enableMutation = trpc.users.enable.useMutation({
    onSuccess: async () => {
      message.success('Access re-enabled.');
      await onChanged();
    },
    onError: (error) => message.error(error.message),
  });
  const unlinkMutation = trpc.users.unlinkEmployee.useMutation({
    onSuccess: async () => {
      message.success('Unlinked from user account.');
      await onChanged();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <div>
      <h5 className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">System Access</h5>
      {linkedUser ? (
        <div className="flex flex-col gap-2 rounded-ui border border-ui bg-ui-2 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text">{linkedUser.email}</span>
            <StatusTag status={linkedUser.status} />
          </div>
          {linkedUser.roleNames.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {linkedUser.roleNames.map((name) => (
                <Tag key={name}>{name}</Tag>
              ))}
            </div>
          ) : null}
          {canManageUsers ? (
            <div className="flex gap-2">
              {linkedUser.status === 'ACTIVE' ? (
                <Popconfirm title="Revoke this user's access? Sessions will be ended." onConfirm={() => disableMutation.mutate({ userId: linkedUser.id })}>
                  <Button size="small" danger loading={disableMutation.isPending}>
                    Revoke Access
                  </Button>
                </Popconfirm>
              ) : linkedUser.status === 'DISABLED' ? (
                <Button size="small" loading={enableMutation.isPending} onClick={() => enableMutation.mutate({ userId: linkedUser.id })}>
                  Re-enable Access
                </Button>
              ) : null}
              <Popconfirm title="Unlink this employee from the user account? The user itself is not deleted." onConfirm={() => unlinkMutation.mutate({ userId: linkedUser.id })}>
                <Button size="small" loading={unlinkMutation.isPending}>
                  Unlink
                </Button>
              </Popconfirm>
            </div>
          ) : null}
        </div>
      ) : !canManageUsers ? (
        <p className="text-[12.5px] text-muted">Not enabled.</p>
      ) : enableFormOpen ? (
        <Form<EnableAccessFormValues>
          form={form}
          layout="vertical"
          requiredMark
          initialValues={{ displayName: fullName }}
          onFinish={(values) =>
            inviteMutation.mutate({
              email: values.email,
              displayName: values.displayName,
              roleIds: values.roleIds,
              employeeId,
              idempotencyKey: crypto.randomUUID(),
            })
          }
        >
          <Form.Item label="Login email" name="email" rules={[{ required: true, type: 'email', message: 'A valid email is required.' }]}>
            <Input placeholder="name@zitaware.in" />
          </Form.Item>
          <Form.Item label="Display name" name="displayName" rules={[{ required: true, message: 'Display name is required.' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Roles" name="roleIds" rules={[{ required: true, message: 'Select at least one role.' }]}>
            <Select mode="multiple" placeholder="Select roles" options={roleOptions.map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button size="small" onClick={() => setEnableFormOpen(false)}>
              Cancel
            </Button>
            <Button size="small" type="primary" htmlType="submit" loading={inviteMutation.isPending}>
              Send Invitation
            </Button>
          </div>
        </Form>
      ) : (
        <Button size="small" onClick={() => setEnableFormOpen(true)}>
          Enable System Access
        </Button>
      )}
    </div>
  );
}

/**
 * An employee's compensation history, with a dated Revise action (ADR-098).
 *
 * Salary is no longer a plain editable field: revising closes the current
 * period and opens a new one, so what someone earned in a past month stays
 * true no matter what happens later.
 */
function SalarySection({ employeeId, canManage, onChanged }: { employeeId: string; canManage: boolean; onChanged: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ grossAmount: string; effectiveFrom: Dayjs; reason?: string }>();
  const [revising, setRevising] = useState(false);

  const revisions = trpc.employees.listSalaryRevisions.useQuery({ employeeId });
  const rows = revisions.data ?? [];
  const current = rows.find((r) => r.isCurrent);

  const reviseMutation = trpc.employees.reviseSalary.useMutation({
    onSuccess: () => {
      message.success('Salary revised.');
      setRevising(false);
      form.resetFields();
      void revisions.refetch();
      onChanged();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <div className="mt-4 border-t border-ui pt-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold text-ink">Salary</div>
        {canManage && !revising ? (
          <Button size="small" onClick={() => setRevising(true)}>
            Revise
          </Button>
        ) : null}
      </div>

      <div className="mb-3 text-[13px]">
        Current: <span className="font-semibold text-ink">{current ? formatMoney(current.grossAmount) : 'Not recorded'}</span>
        {current ? <span className="ml-2 text-[12px] text-muted">since {formatDate(current.effectiveFrom)}</span> : null}
      </div>

      {revising ? (
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            reviseMutation.mutate({
              employeeId,
              grossAmount: values.grossAmount,
              effectiveFrom: values.effectiveFrom.format('YYYY-MM-DD'),
              reason: values.reason?.trim() || undefined,
            })
          }
        >
          <Form.Item
            label="New monthly gross"
            name="grossAmount"
            rules={[{ required: true, message: 'Amount is required.' }, { pattern: DECIMAL_PATTERN, message: 'Enter a valid amount.' }]}
>
            <MoneyInput placeholder="e.g. 62000" />
          </Form.Item>
          <Form.Item
            label="Effective from"
            name="effectiveFrom"
            rules={[{ required: true, message: 'An effective date is required.' }]}
            extra="The current salary is closed the day before this date."
>
            <DatePicker className="w-full" />
          </Form.Item>
          <Form.Item label="Reason" name="reason">
            <Input placeholder="e.g. Annual revision" />
          </Form.Item>
          <div className="flex gap-2">
            <Button onClick={() => setRevising(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={reviseMutation.isPending}>
              Save Revision
            </Button>
          </div>
        </Form>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-baseline justify-between text-[12.5px]">
              <span className="text-muted">
                {formatDate(r.effectiveFrom)} → {r.effectiveTo ? formatDate(r.effectiveTo) : 'current'}
                {r.reason ? ` · ${r.reason}` : ''}
              </span>
              <span className="font-mono text-ink">{formatMoney(r.grossAmount)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmployeeFormBody({
  mode,
  formKey,
  initial,
  onSubmit,
  onCancel,
  submitting,
  salarySection,
  systemAccess,
}: {
  mode: 'create' | 'edit';
  formKey: string;
  salarySection?: React.ReactNode;
  initial: {
    employeeCode: string;
    fullName: string;
    legalEntityId: string | null;
    internalDepartmentId: string | null;
    designationId: string | null;
    employmentTypeId: string | null;
    isReimbursable: boolean;
    displayedSalaryAmount: string | null;
    joiningDate: string | null;
  };
  onSubmit: (values: CoreFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  systemAccess: React.ReactNode | null;
}) {
  const [form] = Form.useForm<CoreFormValues>();
  const formDraft = useFormDraft(formKey);
  useApplyFormDraft(form, formDraft.payload, (payload) => {
    const joiningDate = payload.joiningDate;
    return typeof joiningDate === 'string' ? { ...payload, joiningDate: dayjs(joiningDate) } : payload;
  });

  return (
    <div className="flex flex-col gap-6">
      <Form<CoreFormValues>
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{
          employeeCode: initial.employeeCode,
          fullName: initial.fullName,
          ...(initial.legalEntityId ? { legalEntityId: initial.legalEntityId } : {}),
          ...(initial.internalDepartmentId ? { internalDepartmentId: initial.internalDepartmentId } : {}),
          ...(initial.designationId ? { designationId: initial.designationId } : {}),
          ...(initial.employmentTypeId ? { employmentTypeId: initial.employmentTypeId } : {}),
          isReimbursable: initial.isReimbursable,
          ...(initial.displayedSalaryAmount ? { displayedSalaryAmount: initial.displayedSalaryAmount } : {}),
          ...(initial.joiningDate ? { joiningDate: dayjs(initial.joiningDate) } : {}),
        }}
        onFinish={onSubmit}
      >
        <Form.Item
          label="Employee code"
          name="employeeCode"
          rules={[{ required: true, message: 'Employee code is required.' }, { max: 50 }]}
          extra={mode === 'edit' ? 'Code cannot be changed after creation.' : 'A short immutable identifier (e.g. EMP001).'}
>
          <Input disabled={mode === 'edit'} placeholder="e.g. EMP001" />
        </Form.Item>
        <Form.Item label="Full name" name="fullName" rules={[{ required: true, message: 'Full name is required.' }, { max: 200 }]}>
          <Input placeholder="e.g. Asha Verma" />
        </Form.Item>
        <Form.Item
          label="Legal entity"
          name="legalEntityId"
          rules={[{ required: true, message: 'Legal entity is required.' }]}
          extra="The company this employee works for. Only its employees can be picked on its projects."
        >
          <LegalEntitySelect placeholder="Select legal entity" />
        </Form.Item>
        <Form.Item label="Department" name="internalDepartmentId">
          <MasterSelect type="internal_departments" allowClear placeholder="Select department" />
        </Form.Item>
        <Form.Item label="Designation" name="designationId">
          <MasterSelect type="designations" allowClear placeholder="Select designation" />
        </Form.Item>
        <Form.Item label="Employment type" name="employmentTypeId">
          <MasterSelect type="employment_types" allowClear placeholder="Select employment type" />
        </Form.Item>
        <Form.Item label="Reimbursable" name="isReimbursable" valuePropName="checked">
          <Switch />
        </Form.Item>
        {/* Only when creating. Editing a salary goes through the Salary
            section's dated Revise action instead, so a past month's figure
            can never be silently rewritten (ADR-098). */}
        {mode === 'create' ? (
          <Form.Item
            label="Monthly gross salary"
            name="displayedSalaryAmount"
            rules={[{ pattern: DECIMAL_PATTERN, message: 'Enter a valid amount, e.g. 55000 or 55000.50' }]}
            extra="Recorded as their first salary revision, effective from the joining date."
>
            <MoneyInput placeholder="e.g. 55000" />
          </Form.Item>
        ) : null}
        {/* Not editable here once set; an employee imported without one gets it from a later import. */}
        <Form.Item
          label="Joining date"
          name="joiningDate"
          rules={[{ required: mode === 'create', message: 'Joining date is required.' }]}
          extra={mode === 'edit' && !initial.joiningDate ? 'Not recorded. Add it with the employee import.' : undefined}
        >
          <DatePicker className="w-full" format="DD/MM/YYYY" disabled={mode === 'edit'} />
        </Form.Item>

        <Form.Item className="mt-2 mb-0">
          <FormSaveButtons
            onCancel={onCancel}
            submitting={submitting || formDraft.saving}
            saveLabel={mode === 'create' ? 'Save' : 'Save changes'}
            drafted={formDraft.payload != null}
            onDraft={() => {
              const raw = form.getFieldsValue(true) as { joiningDate?: Dayjs | string };
              const joiningDate = raw.joiningDate && dayjs.isDayjs(raw.joiningDate) ? raw.joiningDate.format('YYYY-MM-DD') : raw.joiningDate;
              formDraft.save({ ...(raw as unknown as Record<string, unknown>), joiningDate });
            }}
          />
        </Form.Item>
      </Form>

      {salarySection}
      {systemAccess}
    </div>
  );
}

export default function EmployeesPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('employee.manage');
  // Salary is confidential (ADR-175); the API leaves it out for everyone else.
  const canSeeSalary = (me.data?.permissions ?? []).includes('employee.read_salary');
  const canManageUsers = (me.data?.permissions ?? []).includes('user.manage');

  const utils = trpc.useUtils();
  const list = trpc.employees.list.useQuery({ includeInactive: true });
  const departments = trpc.masters.list.useQuery({ type: 'internal_departments', includeInactive: true });
  const designations = trpc.masters.list.useQuery({ type: 'designations', includeInactive: true });
  const roleOptions = trpc.roles.list.useQuery();

  // Opened from the top-bar search (?search=…): the list starts filtered to that match.
  const linkedSearch = useSearchParams().get('search') ?? '';
  const [search, setSearch] = useState(linkedSearch);
  const [shownLink, setShownLink] = useState(linkedSearch);
  if (linkedSearch !== shownLink) {
    setShownLink(linkedSearch);
    setSearch(linkedSearch);
  }
  const [departmentFilter, setDepartmentFilter] = useState<string | undefined>(undefined);
  const [legalEntityFilter, setLegalEntityFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('all');
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);

  const detail = trpc.employees.getDetail.useQuery({ id: editingId ?? '' }, { enabled: !!editingId });

  const departmentById = useMemo(() => new Map((departments.data ?? []).map((d) => [d.id, d.name])), [departments.data]);
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: true });
  const legalEntityById = useMemo(() => new Map((legalEntities.data ?? []).map((e) => [e.id, e.legalName])), [legalEntities.data]);
  const designationById = useMemo(() => new Map((designations.data ?? []).map((d) => [d.id, d.name])), [designations.data]);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as EmployeeRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (departmentFilter && row.internalDepartmentId !== departmentFilter) return false;
      if (legalEntityFilter && row.legalEntityId !== legalEntityFilter) return false;
      if (!q) return true;
      return row.fullName.toLowerCase().includes(q) || row.employeeCode.toLowerCase().includes(q);
    });
  }, [list.data, search, statusFilter, departmentFilter, legalEntityFilter]);

  const invalidate = async () => {
    await Promise.all([
      utils.employees.list.invalidate(),
      utils.employees.getDetail.invalidate(),
      utils.employees.listLinkable.invalidate(),
      utils.users.list.invalidate(),
    ]);
  };
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const createMutation = trpc.employees.create.useMutation({
    onSuccess: async () => {
      message.success('Employee added.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'employee:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.employees.update.useMutation({
    onSuccess: async () => {
      message.success('Employee updated.');
      setDrawerOpen(false);
      if (editingId) clearDraft.mutate({ formKey: `employee:${editingId}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setStatusMutation = trpc.employees.setStatus.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const downloadSample = async () => {
    setSampleLoading(true);
    try {
      const file = await utils.employees.downloadImportSample.fetch();
      downloadWorkbook(file.contentBase64, file.filename);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not download the sample.');
    } finally {
      setSampleLoading(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setDrawerOpen(true);
  };
  const openEdit = (row: EmployeeRow) => {
    setEditingId(row.id);
    setDrawerOpen(true);
  };

  const handleSubmit = (values: CoreFormValues) => {
    if (!editingId) {
      if (!values.joiningDate) return;
      const joiningDate = values.joiningDate.format('YYYY-MM-DD');
      createMutation.mutate({
        employeeCode: values.employeeCode,
        fullName: values.fullName,
        legalEntityId: values.legalEntityId,
        internalDepartmentId: values.internalDepartmentId,
        designationId: values.designationId,
        employmentTypeId: values.employmentTypeId,
        isReimbursable: values.isReimbursable,
        displayedSalaryAmount: values.displayedSalaryAmount,
        joiningDate,
      });
    } else if (detail.data) {
      updateMutation.mutate({
        id: detail.data.id,
        fullName: values.fullName,
        legalEntityId: values.legalEntityId,
        internalDepartmentId: values.internalDepartmentId,
        designationId: values.designationId,
        employmentTypeId: values.employmentTypeId,
        isReimbursable: values.isReimbursable,
        displayedSalaryAmount: values.displayedSalaryAmount,
        expectedVersion: detail.data.version,
      });
    }
  };

  const columns: ColumnsType<EmployeeRow> = [
    {
      title: 'Name',
      dataIndex: 'fullName',
      key: 'fullName',
      render: (v: string, row) =>
        canManage ? (
          <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => openEdit(row)}>
            {v}
          </button>
        ) : (
          <span className="font-semibold text-ink">{v}</span>
        ),
    },
    { title: 'Code', dataIndex: 'employeeCode', key: 'employeeCode', width: 110, render: (v: string) => <span className="font-mono text-[12.5px] text-muted">{v}</span> },
    {
      title: 'Legal Entity',
      dataIndex: 'legalEntityId',
      key: 'legalEntityId',
      render: (v: string | null) => (v ? (legalEntityById.get(v) ?? '—') : <span className="text-negative">Not set</span>),
    },
    {
      title: 'Department',
      dataIndex: 'internalDepartmentId',
      key: 'internalDepartmentId',
      render: (v: string | null) => (v ? (departmentById.get(v) ?? '—') : <span className="text-muted-2">—</span>),
    },
    {
      title: 'Designation',
      dataIndex: 'designationId',
      key: 'designationId',
      render: (v: string | null) => (v ? (designationById.get(v) ?? '—') : <span className="text-muted-2">—</span>),
    },
    { title: 'Reimbursable', dataIndex: 'isReimbursable', key: 'isReimbursable', width: 110, render: (v: boolean) => (v ? 'Yes' : 'No') },
    ...(canSeeSalary
      ? [{ title: 'Monthly Salary', dataIndex: 'displayedSalaryAmount', key: 'displayedSalaryAmount', width: 130, align: 'right' as const, render: formatMoney }]
      : []),
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100, render: (v: string) => <StatusTag status={v} /> },
    {
      title: 'System Access',
      dataIndex: 'userId',
      key: 'userId',
      width: 120,
      render: (userId: string | null) => (userId ? <StatusTag status="ACTIVE" label="Linked" /> : <span className="text-muted-2">Not enabled</span>),
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {canManage ? (
            <Button size="small" onClick={() => openEdit(row)}>
              Edit
            </Button>
          ) : null}
          {canManage ? (
            <Popconfirm
              title={row.status === 'ACTIVE' ? 'Deactivate this employee?' : 'Reactivate this employee?'}
              onConfirm={() =>
                setStatusMutation.mutate({
                  id: row.id,
                  status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                  expectedVersion: row.version,
                })
              }
            >
              <Button size="small" danger={row.status === 'ACTIVE'}>
                {row.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
              </Button>
            </Popconfirm>
          ) : null}
        </div>
      ),
    },
  ];

  const bodyReady = !editingId || (!detail.isLoading && !!detail.data);

  return (
    <>
      <PageHeader
        title="Employees"
        description="Staff records, separate from login access. Enable system access from an employee's detail to grant a CRM login."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button loading={sampleLoading} onClick={() => void downloadSample()}>
                Download sample
              </Button>
              <Button onClick={() => setImportOpen(true)}>Import Excel</Button>
              <Button type="primary" onClick={openCreate}>
                Add Employee
              </Button>
            </div>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setSearch('');
                setDepartmentFilter(undefined);
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
              placeholder="Search employees…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[220px]"
            />
          </FilterField>
          <FilterField label="Legal Entity">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={legalEntityFilter}
              onChange={(v?: string) => {
                setLegalEntityFilter(v);
                setPage(1);
              }}
              placeholder="All"
              className="w-[220px]"
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
          <FilterField label="Department">
            <MasterSelect
              type="internal_departments"
              includeInactive
              allowClear
              value={departmentFilter}
              onChange={(v) => {
                setDepartmentFilter(v);
                setPage(1);
              }}
              placeholder="All"
              className="w-[180px]"
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

        <EntityTable<EmployeeRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load employees. Please retry.' : undefined}
          emptyTitle="No employees found"
          emptyDescription={canManage ? 'Use "Add Employee" or "Import Excel" to add staff.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <ImportEmployeesModal open={importOpen} onClose={() => setImportOpen(false)} onImported={invalidate} />

      <Drawer open={drawerOpen} title={editingId ? 'Edit Employee' : 'Add Employee'} onClose={() => setDrawerOpen(false)} width={480} destroyOnHidden>
        {!bodyReady ? (
          <p className="text-[13px] text-muted">Loading…</p>
        ) : (
          <EmployeeFormBody
            key={editingId ?? 'create'}
            mode={editingId ? 'edit' : 'create'}
            formKey={editingId ? `employee:${editingId}` : 'employee:new'}
            initial={
              editingId && detail.data
                ? {
                    employeeCode: detail.data.employeeCode,
                    fullName: detail.data.fullName,
                    legalEntityId: detail.data.legalEntityId,
                    internalDepartmentId: detail.data.internalDepartmentId,
                    designationId: detail.data.designationId,
                    employmentTypeId: detail.data.employmentTypeId,
                    isReimbursable: detail.data.isReimbursable,
                    displayedSalaryAmount: detail.data.displayedSalaryAmount,
                    joiningDate: detail.data.joiningDate,
                  }
                : {
                    employeeCode: '',
                    fullName: '',
                    legalEntityId: legalEntityFilter ?? null,
                    internalDepartmentId: null,
                    designationId: null,
                    employmentTypeId: null,
                    isReimbursable: false,
                    displayedSalaryAmount: null,
                    joiningDate: new Date().toISOString().slice(0, 10),
                  }
            }
            onSubmit={handleSubmit}
            onCancel={() => setDrawerOpen(false)}
            submitting={createMutation.isPending || updateMutation.isPending}
            salarySection={
              editingId && detail.data && canSeeSalary ? (
                <SalarySection employeeId={detail.data.id} canManage={canManage} onChanged={invalidate} />
              ) : null
            }
            systemAccess={
              editingId && detail.data ? (
                <SystemAccessSection
                  employeeId={detail.data.id}
                  fullName={detail.data.fullName}
                  linkedUser={detail.data.user}
                  roleOptions={roleOptions.data ?? []}
                  canManageUsers={canManageUsers}
                  onChanged={invalidate}
                />
              ) : null
            }
          />
        )}
      </Drawer>
    </>
  );
}
