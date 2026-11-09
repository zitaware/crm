'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Select } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, KpiCard, MoneyText, StatusTag, UiCard } from '@zitaware/ui';
import { NextStep } from '@/components/next-step';
import { MasterCreateModal } from '@/components/master-select';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatMoney } from '@/lib/format';

type AllocationStatus = 'DRAFT' | 'SUBMITTED' | 'NOT_STARTED';

interface SummaryRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  legalEntityId: string | null;
  allocationMonth: string;
  status: AllocationStatus;
  totalPercentage: string;
  projectPercentage: string;
  nonProjectPercentage: string;
  grossSalaryAmount: string | null;
  allocatedTotalAmount: string | null;
}

interface LineValue {
  targetKey?: string | undefined;
  percentage?: number | undefined;
  contributionNote?: string | undefined;
}

const STATUS_TONE: Record<AllocationStatus, 'pos' | 'warn' | 'mut'> = {
  SUBMITTED: 'pos',
  DRAFT: 'warn',
  NOT_STARTED: 'mut',
};
const STATUS_TEXT: Record<AllocationStatus, string> = {
  SUBMITTED: 'Submitted',
  DRAFT: 'Draft',
  NOT_STARTED: 'Not started',
};

/** Percentages carry 4 decimals so awkward splits can total exactly 100;
 * trailing zeros are noise on screen. */
function formatPercent(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return `${n.toLocaleString('en-IN', { maximumFractionDigits: 4 })}%`;
}

function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function formatMonthLabel(value: string): string {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * A line's target is one control, not two: the option list mixes projects and
 * non-project targets, prefixed so they are still distinguishable. The server
 * requires exactly one of the two ids, so offering two separate pickers would
 * invite the invalid both-or-neither state the database refuses anyway.
 */
function encodeTarget(kind: 'p' | 't', id: string): string {
  return `${kind}:${id}`;
}
function decodeTarget(key: string | undefined): { projectId?: string | undefined; allocationTargetId?: string | undefined } {
  if (!key) return {};
  const [kind, id] = key.split(':');
  return kind === 'p' ? { projectId: id } : { allocationTargetId: id };
}

function AllocationTargetSelect({
  value,
  onChange,
  options,
}: {
  value?: string;
  onChange?: (value: string | undefined) => void;
  options: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
}) {
  const [search, setSearch] = useState('');
  const [popupOpen, setPopupOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState<Array<{ value: string; label: string }>>([]);
  const groups = options.map((group, index) =>
    index === options.length - 1
      ? {
          ...group,
          options: [...group.options, ...added.filter((extra) => !group.options.some((option) => option.value === extra.value))],
        }
      : group,
  );

  function openPopup() {
    setDraft(search.trim());
    setPopupOpen(true);
  }

  return (
    <div
      className="w-full"
      onKeyDownCapture={(event) => {
        if (event.key !== 'F2') return;
        event.preventDefault();
        event.stopPropagation();
        openPopup();
      }}
    >
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        placeholder="Select…"
        options={groups}
        onSearch={setSearch}
        onInputKeyDown={(event) => {
          if (event.key !== 'F2') return;
          event.preventDefault();
          event.stopPropagation();
          openPopup();
        }}
        {...(value != null && value !== '' ? { value } : { value: null })}
        onChange={(next: string | null | undefined) => onChange?.(next ?? undefined)}
        dropdownRender={(menu) => (
          <>
            {menu}
            <div className="border-t border-ui px-3 py-1.5 text-[11px] text-muted">Press F2 to add a non-project target</div>
          </>
        )}
      />
      <MasterCreateModal
        type="allocation_targets"
        open={popupOpen}
        initialText={draft}
        onClose={() => setPopupOpen(false)}
        onCreated={(id, name) => {
          const encoded = encodeTarget('t', id);
          setAdded((current) => [...current, { value: encoded, label: name }]);
          onChange?.(encoded);
        }}
      />
    </div>
  );
}

export function AllocationTab() {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  // The month is DERIVED until the user picks one. It used to default to the
  // current month, which is the one month that structurally cannot have data:
  // a month's salary is only importable once the month has ended, so this
  // screen always opened on a wall of zeros. It now opens on the most recent
  // month that actually has posted salary.
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<AllocationStatus | undefined>(undefined);
  const [legalEntityFilter, setLegalEntityFilter] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<SummaryRow | null>(null);
  const [reopening, setReopening] = useState(false);
  const [form] = Form.useForm<{ note?: string | undefined; lines: LineValue[] }>();
  const formDraft = useFormDraft(editing ? `allocation:${editing.employeeId}:${editing.allocationMonth}` : 'allocation:closed');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    const token = editing ? `${editing.employeeId}:${editing.allocationMonth}` : '';
    if (!editing || formDraft.isLoading || appliedDraft.current === token) return;
    appliedDraft.current = token;
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as { note?: string; lines: LineValue[] });
  }, [editing, form, formDraft.isLoading, formDraft.payload]);
  const [reopenForm] = Form.useForm<{ reason: string }>();

  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canManage = permissions.includes('employee_allocation.manage');

  const projects = trpc.projects.list.useQuery();
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });
  const targets = trpc.masters.list.useQuery({ type: 'allocation_targets', includeInactive: false });

  // One row, newest first — just enough to know which month is worth showing.
  // Gated on its own permission, so a user without it simply gets the old
  // current-month default rather than an error.
  const canReadSalary = permissions.includes('salary_import.read');
  // Salary is confidential (ADR-175): without this the API sends no amounts, so none are shown.
  const canSeeSalary = permissions.includes('employee.read_salary');
  const latestPosted = trpc.salaryImports.list.useQuery(
    { page: 1, pageSize: 1, status: 'POSTED' },
    { enabled: canReadSalary },
  );
  const latestPostedMonth = latestPosted.data?.rows[0]?.salaryMonth ?? null;
  const month = monthOverride ?? latestPostedMonth ?? currentMonthStart();
  const setMonth = setMonthOverride;


  const summary = trpc.employeeAllocations.getSummary.useQuery({ allocationMonth: month, status: statusFilter });
  const rows = ((summary.data?.rows ?? []) as SummaryRow[]).filter((r) => !legalEntityFilter || r.legalEntityId === legalEntityFilter);

  const detail = trpc.employeeAllocations.getMonth.useQuery(
    { employeeId: editing?.employeeId ?? '', allocationMonth: month },
    { enabled: editing !== null },
  );

  const targetOptions = [
    {
      label: 'Projects',
      // An employee's cost goes only to their own legal entity's projects (ADR-154).
      options: (projects.data ?? [])
        .filter((p) => !editing?.legalEntityId || p.legalEntityId === editing.legalEntityId)
        .map((p) => ({ value: encodeTarget('p', p.id), label: p.name })),
    },
    {
      label: 'Non-project',
      options: (targets.data ?? []).map((t) => ({ value: encodeTarget('t', t.id), label: t.name })),
    },
  ];

  const refresh = () => {
    void utils.employeeAllocations.getSummary.invalidate();
    void utils.employeeAllocations.getMonth.invalidate();
  };

  const saveMutation = trpc.employeeAllocations.saveDraft.useMutation({
    onSuccess: () => {
      message.success('Allocation saved.');
      if (editing) clearDraft.mutate({ formKey: `allocation:${editing.employeeId}:${editing.allocationMonth}` });
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const submitMutation = trpc.employeeAllocations.submit.useMutation({
    onSuccess: () => {
      message.success('Allocation submitted.');
      refresh();
      setEditing(null);
    },
    onError: (error) => message.error(error.message),
  });
  const reopenMutation = trpc.employeeAllocations.reopen.useMutation({
    onSuccess: () => {
      message.success('Allocation reopened for editing.');
      setReopening(false);
      reopenForm.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });

  const openEditor = (row: SummaryRow) => {
    setEditing(row);
    // Seed the form from the server's own copy once it arrives; a fresh month
    // starts with one empty line so there is something to type into.
    void utils.employeeAllocations.getMonth
      .fetch({ employeeId: row.employeeId, allocationMonth: month })
      .then((data) => {
        const seeded: LineValue[] =
          data.lines.length > 0
            ? data.lines.map((l) => ({
                targetKey: l.projectId ? encodeTarget('p', l.projectId) : encodeTarget('t', l.allocationTargetId!),
                percentage: Number(l.percentage),
                contributionNote: l.contributionNote ?? undefined,
              }))
            : [{}];
        form.setFieldsValue({ note: data.note ?? undefined, lines: seeded });
      });
  };

  const columns: ColumnsType<SummaryRow> = [
    { title: 'Code', dataIndex: 'employeeCode', key: 'employeeCode', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
    {
      title: 'Employee',
      dataIndex: 'employeeName',
      key: 'employeeName',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => openEditor(row)}>
          {v}
        </button>
      ),
    },
    { title: 'Project %', dataIndex: 'projectPercentage', key: 'projectPercentage', align: 'right', render: formatPercent },
    { title: 'Non-project %', dataIndex: 'nonProjectPercentage', key: 'nonProjectPercentage', align: 'right', render: formatPercent },
    {
      title: 'Total %',
      dataIndex: 'totalPercentage',
      key: 'totalPercentage',
      align: 'right',
      render: (v: string) => (
        <span className={Number(v) === 100 ? 'font-semibold text-ink' : 'font-semibold text-amber-700'}>{formatPercent(v)}</span>
      ),
    },
    ...(canSeeSalary
      ? [
          {
            title: 'Gross Salary',
            dataIndex: 'grossSalaryAmount',
            key: 'grossSalaryAmount',
            align: 'right' as const,
            // "Not imported" was a dead end — the obvious next click is the salary
            // import that would fill it (ADR-097).
            render: (v: string | null) =>
              v ? (
                <MoneyText tone="neutral">{formatMoney(v)}</MoneyText>
              ) : (
                <button type="button" className="text-muted underline hover:text-brand" onClick={() => router.push('/employee-costing?tab=salary')}>
                  Not imported
                </button>
              ),
          },
        ]
      : []),
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v: AllocationStatus) => <StatusTag status={v} label={STATUS_TEXT[v]} tone={STATUS_TONE[v]} />,
    },
  ];

  const submitted = rows.filter((r) => r.status === 'SUBMITTED').length;
  const missingSalary = rows.filter((r) => r.grossSalaryAmount === null).length;

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Month" value={formatMonthLabel(month)} sub={month === currentMonthStart() ? 'Current month — salary imports after it ends' : 'Salary posted for this month'} />
        <KpiCard label="Submitted" value={`${submitted} of ${rows.length}`} sub={submitted === rows.length && rows.length> 0 ? 'Every employee accounted for' : `${rows.length - submitted} still to enter`} />
        {canSeeSalary ? (
          <KpiCard label="Salary imported" value={`${rows.length - missingSalary} of ${rows.length}`} sub={missingSalary === 0 ? 'Every row has an amount' : `${missingSalary} with no amount attached`} />
        ) : null}
      </div>

      {/* The prerequisite chain, most-blocking first. Only one can apply. */}
      {rows.length > 0 && missingSalary === rows.length ? (
        <div className="mb-4">
          <NextStep
            title={`No salary has been imported for ${formatMonthLabel(month)}`}
            detail={
              month === currentMonthStart()
                ? 'A month\u2019s salary is imported once the month has ended, so the current month is always empty here. Pick an earlier month, or import the last completed one.'
                : 'Percentages can still be entered and submitted \u2014 they simply carry no rupee amount, and no manpower cost appears, until this month\u2019s salary is committed.'
            }
            {...(canReadSalary ? { actionLabel: 'Go to salary', onAction: () => router.push('/employee-costing?tab=salary') } : {})}
          />
        </div>
      ) : missingSalary > 0 ? (
        <div className="mb-4">
          <NextStep
            title={`${missingSalary} of ${rows.length} employees have no imported salary for ${formatMonthLabel(month)}`}
            detail="Their percentages can still be entered and submitted; they simply carry no rupee amount until the month's salary covers them."
            {...(canReadSalary ? { actionLabel: 'Go to salary', onAction: () => router.push('/employee-costing?tab=salary') } : {})}
          />
        </div>
      ) : submitted === 0 && rows.length > 0 ? (
        <div className="mb-4">
          <NextStep
            title="Salary is imported for this month, and nobody has been allocated yet"
            detail="Click an employee below to split their month across projects and non-project work. Submission needs exactly 100%, and only submitted months reach project manpower cost."
          />
        </div>
      ) : null}

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setMonthOverride(null);
                setStatusFilter(undefined);
                setLegalEntityFilter(undefined);
              }}
            >
              Reset
            </Button>
          }
        >
          <FilterField label="Month">
            <DatePicker
              picker="month"
              className="w-[180px]"
              allowClear={false}
              // Bound to `month`, which defaults to the current month. Left
              // unbound, the table showed one month's data while the control
              // sat empty, and Reset changed the data without moving the box.
              value={dayjs(month)}
              onChange={(_d, s) => {
                if (typeof s === 'string' && s) setMonth(`${s}-01`);
              }}
            />
          </FilterField>
          <FilterField label="Legal Entity">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All"
              value={legalEntityFilter}
              onChange={(v?: string) => setLegalEntityFilter(v)}
              className="w-[220px]"
              options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              allowClear
              placeholder="All statuses"
              value={statusFilter}
              onChange={setStatusFilter}
              className="w-[170px]"
              options={[
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'NOT_STARTED', label: 'Not started' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<SummaryRow>
          rowKey="employeeId"
          columns={columns}
          dataSource={rows}
          loading={summary.isLoading}
          errorMessage={summary.isError ? 'Could not load allocations. Please retry.' : undefined}
          emptyTitle="No employees"
          emptyDescription="Active employees appear here once the employee master has rows."
          page={1}
          pageSize={rows.length || 1}
          total={rows.length}
          onPageChange={() => undefined}
        />
      </UiCard>

      <Drawer
        open={editing !== null}
        width={780}
        title={editing ? `${editing.employeeName} — ${month.slice(0, 7)}` : 'Allocation'}
        onClose={() => {
          setEditing(null);
          form.resetFields();
        }}
      >
        {detail.data ? (
          <>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {canSeeSalary ? (
                <KpiCard
                  label="Gross Salary"
                  value={detail.data.grossSalaryAmount ? <MoneyText tone="neutral">{formatMoney(detail.data.grossSalaryAmount)}</MoneyText> : '—'}
                  sub="From the month's salary import"
                />
              ) : null}
              <KpiCard label="Allocated" value={formatPercent(detail.data.totalPercentage)} sub={detail.data.isSubmittable ? 'Exactly 100%' : 'Must be exactly 100%'} />
              <KpiCard
                label="Status"
                value={<StatusTag status={detail.data.status} label={STATUS_TEXT[detail.data.status]} tone={STATUS_TONE[detail.data.status]} />}
              />
            </div>

            {detail.data.status === 'SUBMITTED' ? (
              <Alert
                className="mb-4"
                type="success"
                showIcon
                message="Submitted"
                description="This month is locked. Reopen it to make a correction — nothing is reversed, because allocation posts no journal, but project manpower cost will change."
                action={
                  canManage ? (
                    <Button size="small" onClick={() => setReopening(true)}>
                      Reopen
                    </Button>
                  ) : undefined
                }
              />
            ) : null}

            <Form<{ note?: string | undefined; lines: LineValue[] }>
              form={form}
              layout="vertical"
              disabled={!canManage || detail.data.status === 'SUBMITTED'}
              onFinish={(values) => {
                if (!editing) return;
                saveMutation.mutate({
                  employeeId: editing.employeeId,
                  allocationMonth: month,
                  note: values.note?.trim() || undefined,
                  lines: (values.lines ?? [])
                    .filter((l) => l?.targetKey && l?.percentage)
                    .map((l) => ({
                      ...decodeTarget(l.targetKey),
                      percentage: String(l.percentage),
                      contributionNote: l.contributionNote?.trim() || undefined,
                    })),
                  expectedVersion: detail.data!.id ? detail.data!.version : undefined,
                });
              }}
            >
              <Form.List name="lines">
                {(fields, { add, remove }) => (
                  <div className="flex flex-col gap-3">
                    {fields.map(({ key, ...field }, index) => {
                      const serverLine = detail.data!.lines[index];
                      return (
                        <div key={key} className="rounded-ui border border-ui p-3">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <Form.Item
                              {...field}
                              label="Project or target"
                              name={[field.name, 'targetKey']}
                              className="md:col-span-2"
                              rules={[{ required: true, message: 'Choose a project or a non-project target.' }]}
>
                              <AllocationTargetSelect options={targetOptions} />
                            </Form.Item>
                            <Form.Item {...field} label="Share %" name={[field.name, 'percentage']} rules={[{ required: true, message: 'Required.' }]}>
                              <InputNumber className="w-full" min={0.0001} max={100} precision={4} placeholder="0" />
                            </Form.Item>
                            <Form.Item {...field} label="Contribution note" name={[field.name, 'contributionNote']} className="md:col-span-3">
                              <Input placeholder="Optional — what this person did on it" />
                            </Form.Item>
                          </div>
                          {serverLine?.allocatedAmount ? (
                            <div className="text-[12px] text-muted">
                              Costed at <span className="font-semibold text-ink">{formatMoney(serverLine.allocatedAmount)}</span>
                              {serverLine.carriesRoundingRemainder ? ' — carries the rounding remainder so the month sums exactly' : null}
                            </div>
                          ) : null}
                          {fields.length > 1 ? (
                            <div className="flex justify-end">
                              <Button size="small" danger onClick={() => remove(field.name)}>
                                Remove
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <div>
                      <Button onClick={() => add({})}>Add line</Button>
                    </div>
                  </div>
                )}
              </Form.List>

              <Form.Item label="Note" name="note" className="mt-3">
                <Input.TextArea rows={2} placeholder="Optional" />
              </Form.Item>
            </Form>

            <div className="mt-4 flex items-center justify-between border-t border-ui pt-3">
              <div className="text-[13px] text-muted">Allocated {formatPercent(detail.data.totalPercentage)} of the month.</div>
              <div className="flex gap-2">
                <Button onClick={() => setEditing(null)}>Close</Button>
                {canManage && detail.data.status === 'DRAFT' ? (
                  <>
                    {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
                    <Button
                      htmlType="button"
                      loading={formDraft.saving}
                      onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
                    >
                      Save as draft
                    </Button>
                    <Button loading={saveMutation.isPending} onClick={() => form.submit()}>
                      Save
                    </Button>
                    <Button
                      type="primary"
                      loading={submitMutation.isPending}
                      disabled={!detail.data.isSubmittable}
                      onClick={() =>
                        submitMutation.mutate({
                          employeeId: editing!.employeeId,
                          allocationMonth: month,
                          expectedVersion: detail.data!.version,
                        })
                      }
                    >
                      Submit
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal
        open={reopening}
        title="Reopen allocation"
        okText="Reopen"
        okButtonProps={{ loading: reopenMutation.isPending }}
        onCancel={() => {
          setReopening(false);
          reopenForm.resetFields();
        }}
        onOk={() => reopenForm.submit()}
      >
        <p className="mb-3 text-[13px] text-muted">
          Nothing is reversed — allocation posts no journal — but the project manpower cost derived from this month will
          change, so the reason is recorded in the audit trail.
        </p>
        <Form<{ reason: string }>
          form={reopenForm}
          layout="vertical"
          onFinish={(values) => {
            if (!editing || !detail.data) return;
            reopenMutation.mutate({
              employeeId: editing.employeeId,
              allocationMonth: month,
              expectedVersion: detail.data.version,
              reason: values.reason,
            });
          }}
        >
          <Form.Item label="Reason" name="reason" rules={[{ required: true, message: 'A reason is required.' }]}>
            <Input.TextArea rows={2} placeholder="Why is this being reopened?" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
