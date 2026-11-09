'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { App, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Switch, Tooltip } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatDate } from '@/lib/format';

interface FinancialYearRow {
  id: string;
  legalEntityId: string;
  label: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  version: number;
}

interface AccountingPeriodRow {
  id: string;
  financialYearId: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'SOFT_CLOSED' | 'LOCKED';
  lockedAt: string | null;
  lockedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  version: number;
}

interface CreateFormValues {
  label: string;
  startDate: dayjs.Dayjs;
  endDate: dayjs.Dayjs;
  setCurrent: boolean;
}

type TransitionAction = 'SOFT_CLOSE' | 'LOCK' | 'REOPEN';

const NEXT_ACTIONS: Record<AccountingPeriodRow['status'], { action: TransitionAction; label: string }[]> = {
  OPEN: [{ action: 'SOFT_CLOSE', label: 'Soft Close' }],
  SOFT_CLOSED: [
    { action: 'LOCK', label: 'Lock' },
    { action: 'REOPEN', label: 'Reopen' },
  ],
  LOCKED: [{ action: 'REOPEN', label: 'Reopen' }],
};

function AccountingPeriodsDrawer({
  financialYear,
  onClose,
}: {
  financialYear: FinancialYearRow;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const periods = trpc.financialYears.listAccountingPeriods.useQuery({ financialYearId: financialYear.id });
  const users = trpc.users.list.useQuery();
  const displayNameById = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.displayName])), [users.data]);

  const [pendingTransition, setPendingTransition] = useState<{ period: AccountingPeriodRow; action: TransitionAction } | null>(null);
  const [reason, setReason] = useState('');

  const transitionMutation = trpc.financialYears.transitionAccountingPeriod.useMutation({
    onSuccess: async () => {
      message.success('Period updated.');
      setPendingTransition(null);
      setReason('');
      await utils.financialYears.listAccountingPeriods.invalidate({ financialYearId: financialYear.id });
    },
    onError: (error) => message.error(error.message),
  });

  const rows = (periods.data ?? []) as AccountingPeriodRow[];
  const currentUserId = me.data?.userId;

  const columns: ColumnsType<AccountingPeriodRow> = [
    { title: '#', dataIndex: 'periodNumber', key: 'periodNumber', width: 50 },
    { title: 'Start', dataIndex: 'startDate', key: 'startDate', width: 110, render: (v: string) => formatDate(v) },
    { title: 'End', dataIndex: 'endDate', key: 'endDate', width: 110, render: (v: string) => formatDate(v) },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 110, render: (v: string) => <StatusTag status={v} /> },
    {
      title: 'Locked By',
      dataIndex: 'lockedBy',
      key: 'lockedBy',
      render: (v: string | null) => (v ? (displayNameById.get(v) ?? v) : <span className="text-muted-2">—</span>),
    },
    {
      title: 'Reopened By',
      dataIndex: 'reopenedBy',
      key: 'reopenedBy',
      render: (v: string | null) => (v ? (displayNameById.get(v) ?? v) : <span className="text-muted-2">—</span>),
    },
    {
      title: '',
      key: 'actions',
      width: 200,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {NEXT_ACTIONS[row.status].map(({ action, label }) => {
            const blockedBySelf = action === 'REOPEN' && row.status === 'LOCKED' && row.lockedBy === currentUserId;
            const button = (
              <Button
                size="small"
                danger={action === 'LOCK'}
                disabled={blockedBySelf}
                onClick={() => setPendingTransition({ period: row, action })}
              >
                {label}
              </Button>
            );
            return blockedBySelf ? (
              <Tooltip key={action} title="You locked this period — a different user must reopen it.">
                <span>{button}</span>
              </Tooltip>
            ) : (
              <span key={action}>{button}</span>
            );
          })}
        </div>
      ),
    },
  ];

  return (
    <>
      <Drawer open title={`Accounting Periods — ${financialYear.label}`} onClose={onClose} width={720} destroyOnHidden>
        <EntityTable<AccountingPeriodRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={periods.isLoading}
          errorMessage={periods.isError ? 'Could not load accounting periods. Please retry.' : undefined}
          emptyTitle="No accounting periods found"
          page={1}
          pageSize={12}
          total={rows.length}
          onPageChange={() => undefined}
        />
      </Drawer>

      <Modal
        open={!!pendingTransition}
        title={pendingTransition ? `${NEXT_ACTIONS[pendingTransition.period.status].find((a) => a.action === pendingTransition.action)?.label} Period ${pendingTransition.period.periodNumber}` : ''}
        onCancel={() => {
          setPendingTransition(null);
          setReason('');
        }}
        onOk={() => {
          if (!pendingTransition) return;
          transitionMutation.mutate({
            accountingPeriodId: pendingTransition.period.id,
            action: pendingTransition.action,
            reason,
          });
        }}
        okButtonProps={{ disabled: reason.trim().length === 0, loading: transitionMutation.isPending }}
        okText="Confirm"
        destroyOnHidden
      >
        <p className="mb-2 text-[13px] text-muted">A reason is required and is recorded in the audit trail.</p>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for this change…" maxLength={1000} />
      </Modal>
    </>
  );
}

export default function FinancialYearsPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('financial_year.manage');

  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: true });
  const [legalEntityId, setLegalEntityId] = useState<string | undefined>(undefined);
  const utils = trpc.useUtils();
  const list = trpc.financialYears.list.useQuery({ legalEntityId: legalEntityId ?? '' }, { enabled: !!legalEntityId });

  const [createOpen, setCreateOpen] = useState(false);
  const [viewingFy, setViewingFy] = useState<FinancialYearRow | null>(null);
  const [form] = Form.useForm<CreateFormValues>();
  const formDraft = useFormDraft(createOpen ? 'financial-year:new' : 'financial-year:closed');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    if (!createOpen) {
      appliedDraft.current = '';
      return;
    }
    if (formDraft.isLoading || appliedDraft.current === 'open') return;
    appliedDraft.current = 'open';
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as unknown as CreateFormValues);
  }, [createOpen, form, formDraft.isLoading, formDraft.payload]);

  const invalidate = async () => {
    if (legalEntityId) await utils.financialYears.list.invalidate({ legalEntityId });
  };

  const createMutation = trpc.financialYears.create.useMutation({
    onSuccess: async () => {
      message.success('Financial year created.');
      setCreateOpen(false);
      clearDraft.mutate({ formKey: 'financial-year:new' });
      form.resetFields();
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setCurrentMutation = trpc.financialYears.setCurrentFinancialYear.useMutation({
    onSuccess: async () => {
      message.success('Current financial year updated.');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const rows = (list.data ?? []) as FinancialYearRow[];

  const columns: ColumnsType<FinancialYearRow> = [
    { title: 'Label', dataIndex: 'label', key: 'label', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Start', dataIndex: 'startDate', key: 'startDate', width: 120, render: (v: string) => formatDate(v) },
    { title: 'End', dataIndex: 'endDate', key: 'endDate', width: 120, render: (v: string) => formatDate(v) },
    {
      title: 'Current',
      dataIndex: 'isCurrent',
      key: 'isCurrent',
      width: 110,
      render: (v: boolean) => (v ? <StatusTag status="ACTIVE" label="Current" /> : <span className="text-muted-2">—</span>),
    },
    {
      title: '',
      key: 'actions',
      width: 260,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          <Button size="small" onClick={() => setViewingFy(row)}>
            View Periods
          </Button>
          {canManage && !row.isCurrent ? (
            <Popconfirm
              title="Set this financial year as current?"
              onConfirm={() =>
                setCurrentMutation.mutate({
                  legalEntityId: row.legalEntityId,
                  id: row.id,
                  expectedVersion: row.version,
                })
              }
            >
              <Button size="small" loading={setCurrentMutation.isPending}>
                Set as Current
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
        title="Financial Years"
        description="Financial years and their accounting periods, scoped to a legal entity."
        actions={
          canManage && legalEntityId ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              Add Financial Year
            </Button>
          ) : undefined
        }
      />

      <UiCard>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.04em] text-muted">Legal Entity</span>
          <Select
            placeholder="Select a legal entity"
            className="w-[320px]"
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: `${e.legalName} (${e.panNumber})` }))}
            showSearch
            optionFilterProp="label"
          />
        </label>
      </UiCard>

      {legalEntityId ? (
        <UiCard flush className="mt-4">
          <EntityTable<FinancialYearRow>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            loading={list.isLoading}
            errorMessage={list.isError ? 'Could not load financial years. Please retry.' : undefined}
            emptyTitle="No financial years found"
            emptyDescription={canManage ? 'Use "Add Financial Year" to add one.' : undefined}
            page={1}
            pageSize={25}
            total={rows.length}
            onPageChange={() => undefined}
          />
        </UiCard>
      ) : null}

      <Drawer open={createOpen} title="Add Financial Year" onClose={() => setCreateOpen(false)} width={440} destroyOnHidden>
        <Form<CreateFormValues>
          form={form}
          layout="vertical"
          requiredMark
          initialValues={{ setCurrent: false }}
          onFinish={(values) => {
            if (!legalEntityId) return;
            createMutation.mutate({
              legalEntityId,
              label: values.label,
              startDate: values.startDate.format('YYYY-MM-DD'),
              endDate: values.endDate.format('YYYY-MM-DD'),
              setCurrent: values.setCurrent,
            });
          }}
        >
          <Form.Item label="Label" name="label" rules={[{ required: true, message: 'Label is required.' }, { max: 50 }]}>
            <Input placeholder="e.g. FY2026-27" />
          </Form.Item>
          <Form.Item label="Start date" name="startDate" rules={[{ required: true, message: 'Start date is required.' }]}>
            <DatePicker
              className="w-full"
              onChange={(date) => {
                if (date) form.setFieldsValue({ endDate: date.add(1, 'year').subtract(1, 'day') });
              }}
            />
          </Form.Item>
          <Form.Item
            label="End date"
            name="endDate"
            rules={[{ required: true, message: 'End date is required.' }]}
            extra="Defaults to one year after the start date — editable."
>
            <DatePicker className="w-full" />
          </Form.Item>
          <Form.Item label="Set as current" name="setCurrent" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item className="mt-2 mb-0">
            <div className="flex justify-end gap-[10px]">
              <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
              {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
              <Button
                htmlType="button"
                loading={formDraft.saving}
                onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
              >
                Save as draft
              </Button>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
                Save
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Drawer>

      {viewingFy ? <AccountingPeriodsDrawer financialYear={viewingFy} onClose={() => setViewingFy(null)} /> : null}
    </>
  );
}
