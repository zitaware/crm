'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Collapse, Drawer, Form, Input, Modal, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MoneyInput, StatusTag, UiCard } from '@zitaware/ui';
import type { InvoiceSourceBilling, InvoiceSourceShare } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '../shared';
import { CollectionCell, OutstandingMoney, SettlementMoney, collectionColumns, servicePeriodLabel } from '../../invoices/shared';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { DateInput } from '@/components/date-input';

type MilestoneEventRow = {
  id: string;
  milestoneId: string;
  milestoneCode: string;
  milestoneName: string;
  code: string;
  name: string;
  percentOfPool: string;
  amount: string;
  dueDate: string;
  achievementStatus: 'PLANNED' | 'IN_PROGRESS' | 'ACHIEVED' | 'CANCELLED';
  achievedOn: string | null;
  cancelReason: string | null;
  sequence: number;
  version: number;
  billingStatus: BillingStatus;
  invoiceNumber: string | null;
  paymentAlertId: string | null;
  invoicedAmount: string;
  remainingAmount: string;
};

type BillingStatus = 'NOT_INVOICED' | 'PARTIALLY_INVOICED' | 'FULLY_INVOICED';

type InstallmentRow = {
  id: string;
  sequenceNumber: number;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  plannedInvoiceDate: string;
  scheduledAmount: string;
  status: 'PLANNED' | 'SKIPPED' | 'CANCELLED' | 'INVOICE_DRAFT' | 'INVOICED';
  skipReason: string | null;
  cancelReason: string | null;
  version: number;
  billingStatus: BillingStatus;
  invoiceNumber: string | null;
  paymentAlertId: string | null;
  invoicedAmount: string;
  remainingAmount: string;
};

type OpexMilestoneRow = {
  id: string;
  code: string;
  name: string;
  approvedAmount: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | null;
  installmentCount: number | null;
  achievementStatus: 'PLANNED' | 'IN_PROGRESS' | 'ACHIEVED' | 'CANCELLED' | null;
  billingStatus: BillingStatus;
  invoicedCount: number;
  billableCount: number;
  invoicedAmount: string;
  remainingAmount: string;
  version: number;
  installments: InstallmentRow[] | undefined;
};

interface CapexEventFormRow {
  name: string;
  amount: string;
  percent?: string;
  dueDate: string;
}
interface CapexFormValues {
  name: string;
  approvedAmount: string;
  events: CapexEventFormRow[];
  alertRecipient?: 'ACCOUNT_TEAM' | 'PROJECT_MANAGER' | 'BOTH';
  reminderOffsetDays?: number;
}
interface OpexFormValues {
  name: string;
  approvedAmount: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  installmentCount: number;
  scheduleStartDate: string;
  firstInvoiceDate: string;
  alertRecipient?: 'ACCOUNT_TEAM' | 'PROJECT_MANAGER' | 'BOTH';
  reminderOffsetDays?: number;
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function achievementTone(status: string): 'ACTIVE' | 'INACTIVE' | 'PENDING' {
  if (status === 'ACHIEVED') return 'ACTIVE';
  if (status === 'CANCELLED') return 'INACTIVE';
  return 'PENDING';
}

/** Billing status is derived server-side from finalized invoices (ADR-104) and
 * shown apart from achievement, per docs/04's milestone correction. */
const BILLING_TAG: Record<BillingStatus, { label: string; tone: 'mut' | 'warn' | 'pos' }> = {
  NOT_INVOICED: { label: 'Not invoiced', tone: 'mut' },
  PARTIALLY_INVOICED: { label: 'Partly invoiced', tone: 'warn' },
  FULLY_INVOICED: { label: 'Invoiced', tone: 'pos' },
};

function BillingTag({ status }: { status: BillingStatus }) {
  const tag = BILLING_TAG[status];
  return <StatusTag status={status} label={tag.label} tone={tag.tone} />;
}

/** More than zero left to invoice — the API's own figure, only read here. */
function hasLeftToInvoice(remaining: string): boolean {
  return !remaining.trim().startsWith('-') && !/^0+(\.0+)?$/.test(remaining.trim());
}

/** Still to invoice; a negative figure means more was billed than the event or installment is worth. */
function ToInvoiceMoney({ value }: { value: string }) {
  if (value.trim().startsWith('-')) return <span className="text-negative">Over by {formatMoney(value.trim().slice(1))}</span>;
  return <SettlementMoney value={value} />;
}

/**
 * The finalized invoices that billed one event or installment, and what came
 * back on this source's share of each (ADR-155). docs/04 §11.1: payment is
 * shown by drilling into invoices, not as milestone state.
 */
function SourceInvoices({ billing, projectId }: { billing: InvoiceSourceBilling | undefined; projectId: string }) {
  const router = useRouter();
  if (!billing || billing.invoices.length === 0) {
    return <p className="m-0 py-2 text-[12.5px] text-muted">No finalized invoice has billed this yet.</p>;
  }
  const columns: ColumnsType<InvoiceSourceShare> = [
    {
      title: 'Invoice',
      key: 'invoice',
      render: (_v, row) => (
        <div>
          <Button type="link" size="small" className="h-auto px-0 font-mono" onClick={() => router.push(`/projects/${projectId}/invoices/${row.invoiceId}`)}>
            {row.invoiceNumber ?? '—'}
          </Button>
          <div className="text-[11.5px] text-muted">{row.invoiceDate ? formatDate(row.invoiceDate) : '—'}</div>
          {servicePeriodLabel(row) ? <div className="text-[11.5px] text-muted">{servicePeriodLabel(row)}</div> : null}
        </div>
      ),
    },
    {
      title: 'Billed',
      key: 'billed',
      align: 'right',
      render: (_v, row) => (
        <div>
          <div>{formatMoney(row.billedTaxable)}</div>
          <div className="text-[11.5px] text-muted">incl. GST {formatMoney(row.collection.invoiceTotal)}</div>
        </div>
      ),
    },
    ...collectionColumns<InvoiceSourceShare>((row) => row.collection),
  ];
  const total = billing.collection;
  return (
    <Table<InvoiceSourceShare>
      rowKey="invoiceId"
      size="small"
      columns={columns}
      dataSource={billing.invoices}
      pagination={false}
      tableLayout="auto"
      scroll={{ x: true }}
      summary={() =>
        billing.invoices.length > 1 ? (
          <Table.Summary.Row className="font-semibold">
            <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <div>{formatMoney(billing.billedTaxable)}</div>
              <div className="text-[11.5px] font-normal text-muted">incl. GST {formatMoney(total.invoiceTotal)}</div>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="right">
              <CollectionCell collection={total} />
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <OutstandingMoney value={total.outstanding} />
            </Table.Summary.Cell>
          </Table.Summary.Row>
        ) : null
      }
    />
  );
}

/** Billing status with what is invoiced, what is left and the invoices, stacked in one cell. */
function BillingCell({ row }: { row: { billingStatus: BillingStatus; invoicedAmount: string; remainingAmount: string; invoiceNumber: string | null } }) {
  return (
    <div className="text-[11.5px] text-muted">
      <BillingTag status={row.billingStatus} />
      <div className="mt-0.5">
        Invoiced <span className="text-text"><SettlementMoney value={row.invoicedAmount} /></span>
      </div>
      <div>
        To invoice <span className="text-text"><ToInvoiceMoney value={row.remainingAmount} /></span>
      </div>
      {row.invoiceNumber ? <div className="font-mono">{row.invoiceNumber}</div> : null}
    </div>
  );
}

export function MilestoneTab({ projectId, contractValue }: { projectId: string; contractValue: string | null }) {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const permissions = me.data?.permissions ?? [];
  const canCreate = permissions.includes('milestone.create');
  const canUpdate = permissions.includes('milestone.update');
  const canMarkAchieved = permissions.includes('milestone.mark_achieved');
  const canCancel = permissions.includes('milestone.cancel');
  const canSkip = permissions.includes('milestone.skip_installment');
  const canReadInvoices = permissions.includes('invoice.read');
  const canRaiseInvoice = permissions.includes('invoice.create');
  const router = useRouter();
  // An event or installment is billed from its payment alert, as on the
  // Payment Alert tab; this also reaches one billed in part (ADR-156).
  const raiseInvoice = (row: { paymentAlertId: string | null; remainingAmount: string }) =>
    canRaiseInvoice && row.paymentAlertId && hasLeftToInvoice(row.remainingAmount) ? (
      <Button size="small" type="primary" onClick={() => router.push(`/projects/${projectId}/invoices/new?paymentAlertId=${row.paymentAlertId}`)}>
        Raise Invoice
      </Button>
    ) : null;

  const utils = trpc.useUtils();
  const overview = trpc.milestones.listForProject.useQuery({ projectId });
  const invalidate = () => utils.milestones.listForProject.invalidate({ projectId });

  const capexEvents = (overview.data?.capexEvents ?? []) as MilestoneEventRow[];
  const opexMilestones = (overview.data?.opexMilestones ?? []) as OpexMilestoneRow[];
  const sourceBilling = trpc.invoices.listBySource.useQuery({ projectId }, { enabled: canReadInvoices });
  const billingBySource = useMemo(() => new Map((sourceBilling.data ?? []).map((b) => [b.sourceId, b])), [sourceBilling.data]);
  // Without invoice.read the query is off and the map stays empty, so no row expands.
  const drillDown = {
    rowExpandable: (row: { id: string }) => billingBySource.has(row.id),
    expandedRowRender: (row: { id: string }) => <SourceInvoices billing={billingBySource.get(row.id)} projectId={projectId} />,
  };

  // ------------------------------------------------------------- Add Capex
  const [capexDrawerOpen, setCapexDrawerOpen] = useState(false);
  const [capexForm] = Form.useForm<CapexFormValues>();
  const capexDraft = useFormDraft(capexDrawerOpen ? `milestone-capex:${projectId}` : 'milestone-capex:closed');
  const clearCapexDraft = trpc.formDrafts.clear.useMutation();
  const appliedCapex = useRef(false);
  useEffect(() => {
    if (!capexDrawerOpen || capexDraft.isLoading || appliedCapex.current || !capexDraft.payload) return;
    appliedCapex.current = true;
    capexForm.setFieldsValue(capexDraft.payload as unknown as CapexFormValues);
  }, [capexDrawerOpen, capexDraft.isLoading, capexDraft.payload, capexForm]);
  const [capexIdempotencyKey, setCapexIdempotencyKey] = useState(newIdempotencyKey());
  const capexEventsWatch = Form.useWatch('events', capexForm) as CapexEventFormRow[] | undefined;
  const capexApprovedWatch = Form.useWatch('approvedAmount', capexForm) as string | undefined;

  const capexAllocated = useMemo(() => {
    return (capexEventsWatch ?? []).reduce((sum, e) => sum + (Number(e?.amount) || 0), 0);
  }, [capexEventsWatch]);
  const capexRemaining = (Number(capexApprovedWatch) || 0) - capexAllocated;

  const createCapexMutation = trpc.milestones.createCapex.useMutation({
    onSuccess: async () => {
      message.success('Capex milestone created.');
      clearCapexDraft.mutate({ formKey: `milestone-capex:${projectId}` });
      setCapexDrawerOpen(false);
      capexForm.resetFields();
      setCapexIdempotencyKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const openCapexDrawer = () => {
    capexForm.resetFields();
    capexForm.setFieldsValue({ events: [{ name: '', amount: '', percent: '', dueDate: '' }] });
    setCapexIdempotencyKey(newIdempotencyKey());
    setCapexDrawerOpen(true);
  };
  const submitCapex = (values: CapexFormValues) => {
    createCapexMutation.mutate({
      projectId,
      name: values.name,
      approvedAmount: values.approvedAmount,
      alertRecipient: values.alertRecipient,
      reminderOffsetDays: values.reminderOffsetDays,
      // percent is a client-side entry convenience only — amount is always
      // the value submitted and validated server-side (ADR-063 decision 3);
      // percentOfPool itself is still always derived server-side, never
      // accepted as input.
      events: values.events.map((e) => ({ name: e.name, amount: e.amount, dueDate: e.dueDate })),
      idempotencyKey: capexIdempotencyKey,
    });
  };

  /** Keeps an event row's amount/percent fields in sync in whichever
   * direction the user typed, using the pool's current approved amount.
   * Purely a client-side data-entry convenience — the backend never sees
   * `percent`, and always derives percentOfPool from amount itself. */
  const syncCapexEventField = (fieldName: number, changed: 'amount' | 'percent', value: string) => {
    const approved = Number(capexForm.getFieldValue('approvedAmount'));
    if (!approved || approved <= 0 || value === '' || Number.isNaN(Number(value))) return;
    if (changed === 'amount') {
      const percent = (Number(value) / approved) * 100;
      capexForm.setFieldValue(['events', fieldName, 'percent'], percent.toFixed(2));
    } else {
      const amount = (Number(value) / 100) * approved;
      capexForm.setFieldValue(['events', fieldName, 'amount'], amount.toFixed(2));
    }
  };

  // -------------------------------------------------------------- Add Opex
  const [opexDrawerOpen, setOpexDrawerOpen] = useState(false);
  const [opexForm] = Form.useForm<OpexFormValues>();
  const opexDraft = useFormDraft(opexDrawerOpen ? `milestone-opex:${projectId}` : 'milestone-opex:closed');
  const clearOpexDraft = trpc.formDrafts.clear.useMutation();
  const appliedOpex = useRef(false);
  useEffect(() => {
    if (!opexDrawerOpen || opexDraft.isLoading || appliedOpex.current || !opexDraft.payload) return;
    appliedOpex.current = true;
    opexForm.setFieldsValue(opexDraft.payload as unknown as OpexFormValues);
  }, [opexDrawerOpen, opexDraft.isLoading, opexDraft.payload, opexForm]);
  const [opexIdempotencyKey, setOpexIdempotencyKey] = useState(newIdempotencyKey());
  const opexWatch = Form.useWatch([], opexForm) as OpexFormValues | undefined;

  const previewInput =
    opexWatch?.approvedAmount && opexWatch?.frequency && opexWatch?.installmentCount && opexWatch?.scheduleStartDate && opexWatch?.firstInvoiceDate
      ? {
          approvedAmount: opexWatch.approvedAmount,
          frequency: opexWatch.frequency,
          installmentCount: Number(opexWatch.installmentCount),
          scheduleStartDate: opexWatch.scheduleStartDate,
          firstInvoiceDate: opexWatch.firstInvoiceDate,
        }
      : undefined;
  const preview = trpc.milestones.previewOpexSchedule.useQuery(previewInput!, { enabled: !!previewInput });

  const createOpexMutation = trpc.milestones.createOpex.useMutation({
    onSuccess: async () => {
      message.success('Opex milestone created.');
      clearOpexDraft.mutate({ formKey: `milestone-opex:${projectId}` });
      setOpexDrawerOpen(false);
      opexForm.resetFields();
      setOpexIdempotencyKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const openOpexDrawer = () => {
    opexForm.resetFields();
    setOpexIdempotencyKey(newIdempotencyKey());
    setOpexDrawerOpen(true);
  };
  const submitOpex = (values: OpexFormValues) => {
    createOpexMutation.mutate({
      projectId,
      name: values.name,
      approvedAmount: values.approvedAmount,
      frequency: values.frequency,
      installmentCount: Number(values.installmentCount),
      scheduleStartDate: values.scheduleStartDate,
      firstInvoiceDate: values.firstInvoiceDate,
      alertRecipient: values.alertRecipient,
      reminderOffsetDays: values.reminderOffsetDays,
      idempotencyKey: opexIdempotencyKey,
    });
  };

  // ------------------------------------------------------------ Edit event
  const [editEventTarget, setEditEventTarget] = useState<MilestoneEventRow | null>(null);
  const [editEventForm] = Form.useForm<{ name: string; amount: string; dueDate: string }>();
  const updateEventMutation = trpc.milestones.updateEvent.useMutation({
    onSuccess: async () => {
      message.success('Event updated.');
      setEditEventTarget(null);
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const openEditEvent = (row: MilestoneEventRow) => {
    setEditEventTarget(row);
    editEventForm.setFieldsValue({ name: row.name, amount: row.amount, dueDate: row.dueDate });
  };
  const submitEditEvent = (values: { name: string; amount: string; dueDate: string }) => {
    if (!editEventTarget) return;
    updateEventMutation.mutate({
      id: editEventTarget.id,
      name: values.name,
      amount: values.amount,
      dueDate: values.dueDate,
      expectedVersion: editEventTarget.version,
    });
  };

  // ------------------------------------------------------- Lifecycle actions
  const [achieveTarget, setAchieveTarget] = useState<{ kind: 'event' | 'milestone'; id: string; version: number } | null>(null);
  const [achievedOnInput, setAchievedOnInput] = useState('');
  const [reasonTarget, setReasonTarget] = useState<{ kind: 'cancel-event' | 'cancel-milestone' | 'skip-installment'; id: string; version: number } | null>(null);
  const [reasonInput, setReasonInput] = useState('');

  const startEventMutation = trpc.milestones.startEvent.useMutation({
    onSuccess: async () => { message.success('Event started.'); await invalidate(); },
    onError: (error) => message.error(error.message),
  });
  const markEventAchievedMutation = trpc.milestones.markEventAchieved.useMutation({
    onSuccess: async () => { message.success('Event marked achieved.'); setAchieveTarget(null); setAchievedOnInput(''); await invalidate(); },
    onError: (error) => message.error(error.message),
  });
  const cancelEventMutation = trpc.milestones.cancelEvent.useMutation({
    onSuccess: async () => { message.success('Event cancelled.'); setReasonTarget(null); setReasonInput(''); await invalidate(); },
    onError: (error) => message.error(error.message),
  });
  const startMilestoneMutation = trpc.milestones.startMilestone.useMutation({
    onSuccess: async () => { message.success('Milestone started.'); await invalidate(); },
    onError: (error) => message.error(error.message),
  });
  const markMilestoneAchievedMutation = trpc.milestones.markMilestoneAchieved.useMutation({
    onSuccess: async () => { message.success('Milestone marked achieved.'); setAchieveTarget(null); setAchievedOnInput(''); await invalidate(); },
    onError: (error) => message.error(error.message),
  });
  const cancelMilestoneMutation = trpc.milestones.cancelMilestone.useMutation({
    onSuccess: async () => { message.success('Milestone cancelled.'); setReasonTarget(null); setReasonInput(''); await invalidate(); },
    onError: (error) => message.error(error.message),
  });
  const skipInstallmentMutation = trpc.milestones.skipInstallment.useMutation({
    onSuccess: async () => { message.success('Installment skipped.'); setReasonTarget(null); setReasonInput(''); await invalidate(); },
    onError: (error) => message.error(error.message),
  });

  const submitAchieve = () => {
    if (!achieveTarget || !achievedOnInput) return;
    if (achieveTarget.kind === 'event') {
      markEventAchievedMutation.mutate({ id: achieveTarget.id, achievedOn: achievedOnInput, expectedVersion: achieveTarget.version });
    } else {
      markMilestoneAchievedMutation.mutate({ id: achieveTarget.id, achievedOn: achievedOnInput, expectedVersion: achieveTarget.version });
    }
  };
  const submitReason = () => {
    if (!reasonTarget || !reasonInput.trim()) return;
    if (reasonTarget.kind === 'cancel-event') {
      cancelEventMutation.mutate({ id: reasonTarget.id, reason: reasonInput.trim(), expectedVersion: reasonTarget.version });
    } else if (reasonTarget.kind === 'cancel-milestone') {
      cancelMilestoneMutation.mutate({ id: reasonTarget.id, reason: reasonInput.trim(), expectedVersion: reasonTarget.version });
    } else {
      skipInstallmentMutation.mutate({ id: reasonTarget.id, reason: reasonInput.trim(), expectedVersion: reasonTarget.version });
    }
  };

  const capexColumns: ColumnsType<MilestoneEventRow> = [
    {
      title: 'Event',
      key: 'event',
      render: (_v, row) => (
        <div>
          <div className="font-medium text-ink">{row.name}</div>
          <div className="text-[11.5px] text-muted">
            {row.code} · {row.milestoneName} · {row.percentOfPool}%
          </div>
        </div>
      ),
    },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Billing', key: 'billing', render: (_v, row) => <BillingCell row={row} /> },
    {
      title: 'Due / Achievement',
      key: 'due',
      render: (_v, row) => (
        <div>
          <div>{formatDate(row.dueDate)}</div>
          <StatusTag status={achievementTone(row.achievementStatus)} label={row.achievementStatus.replace('_', ' ')} />
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {raiseInvoice(row)}
          {canUpdate && (row.achievementStatus === 'PLANNED' || row.achievementStatus === 'IN_PROGRESS') ? (
            <Button size="small" onClick={() => openEditEvent(row)}>
              Edit
            </Button>
          ) : null}
          {canMarkAchieved && row.achievementStatus === 'PLANNED' ? (
            <Button size="small" onClick={() => startEventMutation.mutate({ id: row.id, expectedVersion: row.version })} loading={startEventMutation.isPending}>
              Start
            </Button>
          ) : null}
          {canMarkAchieved && row.achievementStatus === 'IN_PROGRESS' ? (
            <Button
              size="small"
              onClick={() => {
                setAchieveTarget({ kind: 'event', id: row.id, version: row.version });
                setAchievedOnInput(new Date().toISOString().slice(0, 10));
              }}
            >
              Mark Achieved
            </Button>
          ) : null}
          {canCancel && (row.achievementStatus === 'PLANNED' || row.achievementStatus === 'IN_PROGRESS') ? (
            <Button size="small" danger onClick={() => setReasonTarget({ kind: 'cancel-event', id: row.id, version: row.version })}>
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const opexColumns: ColumnsType<OpexMilestoneRow> = [
    {
      title: 'Milestone',
      key: 'milestone',
      render: (_v, row) => (
        <div>
          <div className="font-medium text-ink">{row.name}</div>
          <div className="text-[11.5px] text-muted">
            {row.code}
            {row.frequency ? ` · ${row.frequency.charAt(0)}${row.frequency.slice(1).toLowerCase()}` : ''}
            {row.installmentCount ? ` · ${row.installmentCount} installments` : ''}
          </div>
        </div>
      ),
    },
    { title: 'Amount', dataIndex: 'approvedAmount', key: 'approvedAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Billing',
      key: 'billing',
      render: (_v, row) => (
        <div>
          <BillingCell row={{ ...row, invoiceNumber: null }} />
          <div className="text-[11.5px] text-muted">
            {row.invoicedCount} of {row.billableCount} installments invoiced
          </div>
        </div>
      ),
    },
    {
      title: 'Achievement',
      dataIndex: 'achievementStatus',
      key: 'achievementStatus',
      render: (v: string | null) => (v ? <StatusTag status={achievementTone(v)} label={v.replace('_', ' ')} /> : '—'),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {canMarkAchieved && row.achievementStatus === 'PLANNED' ? (
            <Button size="small" onClick={() => startMilestoneMutation.mutate({ id: row.id, expectedVersion: row.version })} loading={startMilestoneMutation.isPending}>
              Start
            </Button>
          ) : null}
          {canMarkAchieved && row.achievementStatus === 'IN_PROGRESS' ? (
            <Button
              size="small"
              onClick={() => {
                setAchieveTarget({ kind: 'milestone', id: row.id, version: row.version });
                setAchievedOnInput(new Date().toISOString().slice(0, 10));
              }}
            >
              Mark Achieved
            </Button>
          ) : null}
          {canCancel && (row.achievementStatus === 'PLANNED' || row.achievementStatus === 'IN_PROGRESS') ? (
            <Button size="small" danger onClick={() => setReasonTarget({ kind: 'cancel-milestone', id: row.id, version: row.version })}>
              Cancel
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const installmentColumns: ColumnsType<InstallmentRow> = [
    {
      title: 'Installment',
      key: 'installment',
      render: (_v, row) => (
        <div>
          <div className="font-medium text-ink">#{row.sequenceNumber}</div>
          <div className="text-[11.5px] text-muted">
            {formatDate(row.servicePeriodStart)} – {formatDate(row.servicePeriodEnd)}
          </div>
          <div className="text-[11.5px] text-muted">Invoice by {formatDate(row.plannedInvoiceDate)}</div>
        </div>
      ),
    },
    { title: 'Amount', dataIndex: 'scheduledAmount', key: 'scheduledAmount', align: 'right', render: (v: string) => formatMoney(v) },
    { title: 'Billing', key: 'billing', render: (_v, row) => <BillingCell row={row} /> },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => <StatusTag status={v === 'PLANNED' ? 'PENDING' : 'INACTIVE'} label={v.replace('_', ' ')} />,
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, row) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {raiseInvoice(row)}
          {canSkip && row.status === 'PLANNED' && row.billingStatus === 'NOT_INVOICED' ? (
            <Button size="small" onClick={() => setReasonTarget({ kind: 'skip-installment', id: row.id, version: row.version })}>
              Skip
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const parentOptions = [
    { value: 'ACCOUNT_TEAM', label: 'Account Team' },
    { value: 'PROJECT_MANAGER', label: 'Project Manager' },
    { value: 'BOTH', label: 'Both' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-[13px] sm:grid-cols-3">
        <UiCard>
          <div className="text-[11px] uppercase tracking-[.06em] text-muted-2">Capex Total</div>
          <div className="text-[20px] font-semibold text-ink">{formatMoney(overview.data?.capexTotalAmount ?? null)}</div>
          <div className="text-[12px] text-muted">Invoiced {formatMoney(overview.data?.capexInvoicedAmount ?? null)}</div>
        </UiCard>
        <UiCard>
          <div className="text-[11px] uppercase tracking-[.06em] text-muted-2">Opex Total</div>
          <div className="text-[20px] font-semibold text-ink">{formatMoney(overview.data?.opexTotalAmount ?? null)}</div>
          <div className="text-[12px] text-muted">Invoiced {formatMoney(overview.data?.opexInvoicedAmount ?? null)}</div>
        </UiCard>
        <UiCard>
          <div className="text-[11px] uppercase tracking-[.06em] text-muted-2">Contract Value</div>
          <div className="text-[20px] font-semibold text-ink">{formatMoney(contractValue)}</div>
        </UiCard>
      </div>

      <UiCard
        title="Capex Milestones"
        actions={canCreate ? <Button size="small" onClick={openCapexDrawer}>Add Capex</Button> : undefined}
      >
        <Table<MilestoneEventRow>
          rowKey="id"
          size="small"
          columns={capexColumns}
          dataSource={capexEvents}
          loading={overview.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No capex events yet.' }}
          expandable={drillDown}
        />
      </UiCard>

      <UiCard
        title="Opex Milestones"
        actions={canCreate ? <Button size="small" onClick={openOpexDrawer}>Add Opex</Button> : undefined}
      >
        <Table<OpexMilestoneRow>
          rowKey="id"
          size="small"
          columns={opexColumns}
          dataSource={opexMilestones}
          loading={overview.isLoading}
          pagination={false}
          tableLayout="auto"
          scroll={{ x: true }}
          locale={{ emptyText: 'No opex milestones yet.' }}
          expandable={{
            expandedRowRender: (row) => (
              <Table<InstallmentRow>
                rowKey="id"
                size="small"
                columns={installmentColumns}
                dataSource={row.installments ?? []}
                pagination={false}
                tableLayout="auto"
                scroll={{ x: true }}
                expandable={drillDown}
              />
            ),
          }}
        />
      </UiCard>

      {/* -------------------------------------------------------- Add Capex */}
      <Drawer open={capexDrawerOpen} title="Add Capex Milestone" onClose={() => setCapexDrawerOpen(false)} width={560} destroyOnHidden>
        <Form<CapexFormValues> form={capexForm} layout="vertical" requiredMark onFinish={submitCapex}>
          <Form.Item label="Capex pool name" name="name" rules={[{ required: true, message: 'Pool name is required.' }, { max: 300 }]}>
            <Input placeholder="e.g. Implementation Capex" />
          </Form.Item>
          <Form.Item label="Approved amount" name="approvedAmount" rules={[{ required: true, message: 'Approved amount is required.' }]}>
            <MoneyInput placeholder="e.g. 70000000" />
          </Form.Item>

          <h5 className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Payment Events</h5>
          <Form.List name="events">
            {(fields, { add, remove }) => (
              <div className="flex flex-col gap-3">
                {fields.map(({ key, ...field }) => (
                  <div key={key} className="flex items-start gap-2 rounded-ui border border-ui p-3">
                    <div className="flex flex-1 flex-col gap-2">
                      <Form.Item
                        {...field}
                        label="Event / Trigger"
                        name={[field.name, 'name']}
                        rules={[{ required: true, message: 'Event name is required.' }]}
                        className="mb-0"
>
                        <Input placeholder="e.g. On Design Sign-off" />
                      </Form.Item>
                      <div className="flex gap-2">
                        <Form.Item
                          {...field}
                          label="Percentage"
                          name={[field.name, 'percent']}
                          className="mb-0 flex-1"
>
                          <Input
                            placeholder="0.00"
                            suffix="%"
                            onChange={(e) => syncCapexEventField(field.name, 'percent', e.target.value)}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          label="Amount"
                          name={[field.name, 'amount']}
                          rules={[{ required: true, message: 'Amount is required.' }]}
                          className="mb-0 flex-1"
>
                          <MoneyInput placeholder="0.00" onChange={(value) => syncCapexEventField(field.name, 'amount', value ?? '')} />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          label="Due date"
                          name={[field.name, 'dueDate']}
                          rules={[{ required: true, message: 'Due date is required.' }]}
                          className="mb-0 flex-1"
>
                          <DateInput />
                        </Form.Item>
                      </div>
                      <p className="mb-0 text-[11px] text-muted">
                        Enter either percentage or amount — the other fills in automatically from the approved amount.
                      </p>
                    </div>
                    <Button danger size="small" onClick={() => remove(field.name)} disabled={fields.length <= 1}>
                      Remove
                    </Button>
                  </div>
                ))}
                <Button onClick={() => add({ name: '', amount: '', percent: '', dueDate: '' })}>Add event</Button>
              </div>
            )}
          </Form.List>

          <div className="mt-3 flex items-center justify-between rounded-ui border border-ui bg-paper p-3 text-[13px]">
            <span>Allocated: {formatMoney(String(capexAllocated))}</span>
            <span className={capexRemaining === 0 ? 'font-semibold text-positive' : 'font-semibold text-negative'}>
              Remaining: {formatMoney(String(capexRemaining))}
            </span>
          </div>

          <Collapse
            className="mt-4"
            items={[
              {
                key: 'alerts',
                label: 'Alert settings (inactive until Payment Alerts ships)',
                children: (
                  <div className="flex flex-col gap-3">
                    <Form.Item label="Raise alert to" name="alertRecipient" initialValue="ACCOUNT_TEAM">
                      <Select options={parentOptions} />
                    </Form.Item>
                    <Form.Item label="Remind before due date (days)" name="reminderOffsetDays" initialValue={3}>
                      <Input type="number" min={0} max={90} />
                    </Form.Item>
                  </div>
                ),
              },
            ]}
          />

          <div className="mt-4 flex flex-wrap justify-end gap-[10px]">
            {capexDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
            <Button
              htmlType="button"
              loading={capexDraft.saving}
              onClick={() => capexDraft.save(capexForm.getFieldsValue(true) as unknown as Record<string, unknown>)}
            >
              Save as draft
            </Button>
            <Button type="primary" htmlType="submit" disabled={capexRemaining !== 0} loading={createCapexMutation.isPending}>
              Save
            </Button>
          </div>
        </Form>
      </Drawer>

      {/* --------------------------------------------------------- Add Opex */}
      <Drawer open={opexDrawerOpen} title="Add Opex Milestone" onClose={() => setOpexDrawerOpen(false)} width={560} destroyOnHidden>
        <Form<OpexFormValues> form={opexForm} layout="vertical" requiredMark onFinish={submitOpex}>
          <Form.Item label="Opex item name" name="name" rules={[{ required: true, message: 'Name is required.' }, { max: 300 }]}>
            <Input placeholder="e.g. Manpower & Support" />
          </Form.Item>
          <Form.Item label="Total amount (full period)" name="approvedAmount" rules={[{ required: true, message: 'Total amount is required.' }]}>
            <MoneyInput placeholder="e.g. 20000000" />
          </Form.Item>
          <Form.Item label="Frequency" name="frequency" rules={[{ required: true, message: 'Frequency is required.' }]}>
            <Select
              options={[
                { value: 'MONTHLY', label: 'Monthly' },
                { value: 'QUARTERLY', label: 'Quarterly' },
                { value: 'YEARLY', label: 'Yearly' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Installment count" name="installmentCount" rules={[{ required: true, message: 'Installment count is required.' }]}>
            <Input type="number" min={1} placeholder="e.g. 36" />
          </Form.Item>
          <Form.Item label="Schedule start date" name="scheduleStartDate" rules={[{ required: true, message: 'Schedule start date is required.' }]}>
            <DateInput />
          </Form.Item>
          <Form.Item label="First invoice date" name="firstInvoiceDate" rules={[{ required: true, message: 'First invoice date is required.' }]}>
            <DateInput />
          </Form.Item>

          {preview.data && preview.data.length > 0 ? (
            <div className="mb-4 rounded-ui border border-ui bg-paper p-3 text-[13px]">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.04em] text-muted">
                Auto-calculated installment plan (server-computed)
              </div>
              <div className="text-ink">
                {preview.data.length} installments · first {formatMoney(preview.data[0]!.scheduledAmount)} · last{' '}
                {formatMoney(preview.data[preview.data.length - 1]!.scheduledAmount)} on{' '}
                {formatDate(preview.data[preview.data.length - 1]!.plannedInvoiceDate)}
              </div>
            </div>
          ) : null}

          <Collapse
            className="mb-4"
            items={[
              {
                key: 'alerts',
                label: 'Alert settings (inactive until Payment Alerts ships)',
                children: (
                  <div className="flex flex-col gap-3">
                    <Form.Item label="Raise alert to" name="alertRecipient" initialValue="ACCOUNT_TEAM">
                      <Select options={parentOptions} />
                    </Form.Item>
                    <Form.Item label="Remind before due date (days)" name="reminderOffsetDays" initialValue={3}>
                      <Input type="number" min={0} max={90} />
                    </Form.Item>
                  </div>
                ),
              },
            ]}
          />

          <div className="flex flex-wrap justify-end gap-[10px]">
            {opexDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
            <Button
              htmlType="button"
              loading={opexDraft.saving}
              onClick={() => opexDraft.save(opexForm.getFieldsValue(true) as unknown as Record<string, unknown>)}
            >
              Save as draft
            </Button>
            <Button type="primary" htmlType="submit" loading={createOpexMutation.isPending}>
              Save
            </Button>
          </div>
        </Form>
      </Drawer>

      {/* --------------------------------------------------- Edit event modal */}
      <Modal
        title="Edit Event"
        open={!!editEventTarget}
        onCancel={() => setEditEventTarget(null)}
        onOk={() => editEventForm.submit()}
        confirmLoading={updateEventMutation.isPending}
      >
        <Form form={editEventForm} layout="vertical" onFinish={submitEditEvent}>
          <Form.Item label="Event / Trigger" name="name" rules={[{ required: true, message: 'Name is required.' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Amount" name="amount" rules={[{ required: true, message: 'Amount is required.' }]}>
            <MoneyInput />
          </Form.Item>
          <Form.Item label="Due date" name="dueDate" rules={[{ required: true, message: 'Due date is required.' }]}>
            <DateInput />
          </Form.Item>
          <p className="text-[11.5px] text-muted">
            Changing the amount is only allowed if the pool&apos;s event total still sums to the approved amount exactly.
          </p>
        </Form>
      </Modal>

      {/* ------------------------------------------------------ Achieve modal */}
      <Modal
        title="Mark Achieved"
        open={!!achieveTarget}
        onCancel={() => setAchieveTarget(null)}
        onOk={submitAchieve}
        confirmLoading={markEventAchievedMutation.isPending || markMilestoneAchievedMutation.isPending}
        okButtonProps={{ disabled: !achievedOnInput }}
      >
        <p className="mb-2 text-muted">Achieved on</p>
        <DateInput value={achievedOnInput} onChange={setAchievedOnInput} />
      </Modal>

      {/* ------------------------------------------------------- Reason modal */}
      <Modal
        title={reasonTarget?.kind === 'skip-installment' ? 'Skip Installment' : 'Cancel'}
        open={!!reasonTarget}
        onCancel={() => setReasonTarget(null)}
        onOk={submitReason}
        confirmLoading={cancelEventMutation.isPending || cancelMilestoneMutation.isPending || skipInstallmentMutation.isPending}
        okButtonProps={{ disabled: !reasonInput.trim(), danger: reasonTarget?.kind !== 'skip-installment' }}
      >
        <p className="mb-2 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} />
      </Modal>
    </div>
  );
}
