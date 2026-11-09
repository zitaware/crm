'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Input, Modal, Popconfirm } from 'antd';
import { StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '../shared';
import { DateInput } from '@/components/date-input';

type AlertRow = {
  id: string;
  projectId: string;
  sourceType: 'CAPEX_EVENT' | 'OPEX_INSTALLMENT';
  title: string;
  milestoneCode: string;
  dueDate: string;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  amount: string;
  invoicedAmount: string;
  remainingAmount: string;
  latestInvoice: { id: string; invoiceNumber: string | null; version: number } | null;
  status: 'OPEN' | 'SNOOZED';
  derivedLabel: 'OVERDUE' | 'DUE' | 'SNOOZED';
  snoozedUntil: string | null;
  snoozeNote: string | null;
  openedAt: string;
  version: number;
};

function defaultSnoozeDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function PaymentAlertTab({ projectId }: { projectId: string }) {
  const { message } = App.useApp();
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const permissions = me.data?.permissions ?? [];
  const canSnooze = permissions.includes('payment_alert.snooze');
  const canInvoice = permissions.includes('invoice.create');
  const canFinalize = permissions.includes('invoice.finalize');

  const utils = trpc.useUtils();
  const overview = trpc.paymentAlerts.listForProject.useQuery({ projectId });
  const invalidate = () => utils.paymentAlerts.listForProject.invalidate({ projectId });

  const openAlerts = (overview.data?.openAlerts ?? []) as AlertRow[];
  const snoozedAlerts = (overview.data?.snoozedAlerts ?? []) as AlertRow[];

  const [snoozeTarget, setSnoozeTarget] = useState<AlertRow | null>(null);
  const [snoozeDate, setSnoozeDate] = useState('');
  const [snoozeNote, setSnoozeNote] = useState('');

  // An installment or event already invoiced for a little less than its
  // amount: mark that invoice as the full bill, which closes the alert (ADR-167).
  const fullBillMutation = trpc.invoices.setCompletesSource.useMutation({
    onSuccess: async () => {
      message.success('Marked as fully billed. The alert is closed.');
      await Promise.all([invalidate(), utils.milestones.invalidate(), utils.invoices.invalidate()]);
    },
    onError: (error) => message.error(error.message),
  });

  const snoozeMutation = trpc.paymentAlerts.snooze.useMutation({
    onSuccess: async () => {
      message.success('Alert snoozed.');
      setSnoozeTarget(null);
      setSnoozeDate('');
      setSnoozeNote('');
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const openSnooze = (row: AlertRow) => {
    setSnoozeTarget(row);
    setSnoozeDate(defaultSnoozeDate());
    setSnoozeNote('');
  };
  const submitSnooze = () => {
    if (!snoozeTarget || !snoozeDate) return;
    snoozeMutation.mutate({
      id: snoozeTarget.id,
      snoozedUntil: snoozeDate,
      note: snoozeNote.trim() || undefined,
      expectedVersion: snoozeTarget.version,
    });
  };

  function AlertCard({ row }: { row: AlertRow }) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-ui border border-ui p-3">
        <div className="flex items-start gap-3">
          <StatusTag status={row.derivedLabel} />
          <div>
            <div className="font-medium text-ink">{row.title}</div>
            <div className="text-[11.5px] text-muted">
              {row.sourceType === 'CAPEX_EVENT' ? 'Capex event' : 'Opex installment'} · {row.milestoneCode}
              {row.servicePeriodStart && row.servicePeriodEnd ? ` · Period ${formatDate(row.servicePeriodStart)} – ${formatDate(row.servicePeriodEnd)}` : ''}
            </div>
            <div className="mt-1 flex gap-3 text-[11.5px] text-muted">
              <span>
                <b>{row.status === 'SNOOZED' ? 'Re-alerts' : 'Due'}</b>{' '}
                {formatDate(row.status === 'SNOOZED' ? (row.snoozedUntil ?? row.dueDate) : row.dueDate)}
              </span>
              <span>
                <b>Amount</b> {formatMoney(row.amount)}
              </span>
              {/^0+(\.0+)?$/.test(row.invoicedAmount) ? null : (
                <span>
                  <b>Invoiced</b> {formatMoney(row.invoicedAmount)} · <b>Left to invoice</b> {formatMoney(row.remainingAmount)}
                </span>
              )}
            </div>
            {row.status === 'SNOOZED' && row.snoozeNote ? <div className="mt-1 text-[11.5px] text-muted">Note: {row.snoozeNote}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canFinalize && row.latestInvoice && Number(row.remainingAmount) > 0 ? (
            <Popconfirm
              title="Mark as fully billed?"
              description={
                <span className="block max-w-[320px]">
                  Invoice {row.latestInvoice.invoiceNumber} billed {formatMoney(row.invoicedAmount)} of {formatMoney(row.amount)}. Treat it as the full bill: the{' '}
                  {formatMoney(row.remainingAmount)} left will not be billed, and this alert closes.
                </span>
              }
              okText="Mark fully billed"
              onConfirm={() => fullBillMutation.mutate({ id: row.latestInvoice!.id, completesSource: true, expectedVersion: row.latestInvoice!.version })}
            >
              <Button size="small" loading={fullBillMutation.isPending}>
                Mark fully billed
              </Button>
            </Popconfirm>
          ) : null}
          {canSnooze ? (
            <Button size="small" onClick={() => openSnooze(row)}>
              Snooze
            </Button>
          ) : null}
          {canInvoice ? (
            <Button
              size="small"
              type="primary"
              onClick={() => router.push(`/projects/${projectId}/invoices/new?paymentAlertId=${row.id}`)}
            >
              Raise Invoice
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-[13px] sm:grid-cols-4">
        <UiCard>
          <div className="text-[11px] uppercase tracking-[.06em] text-muted-2">Overdue</div>
          <div className="text-[20px] font-semibold text-negative">{overview.data?.overdueCount ?? 0}</div>
        </UiCard>
        <UiCard>
          <div className="text-[11px] uppercase tracking-[.06em] text-muted-2">Due Now</div>
          <div className="text-[20px] font-semibold text-warning">{overview.data?.dueCount ?? 0}</div>
        </UiCard>
        <UiCard>
          <div className="text-[11px] uppercase tracking-[.06em] text-muted-2">Snoozed</div>
          <div className="text-[20px] font-semibold text-information">{overview.data?.snoozedCount ?? 0}</div>
        </UiCard>
        <UiCard>
          <div className="text-[11px] uppercase tracking-[.06em] text-muted-2">Pending Amount</div>
          <div className="text-[20px] font-semibold text-ink">{formatMoney(overview.data?.pendingAmount ?? null)}</div>
        </UiCard>
      </div>

      <UiCard title="Open Alerts">
        {overview.isLoading ? (
          <p className="text-muted">Loading…</p>
        ) : overview.isError ? (
          <p className="text-negative">Could not load payment alerts.</p>
        ) : openAlerts.length === 0 ? (
          <p className="text-muted">No open alerts.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {openAlerts.map((row) => (
              <AlertCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </UiCard>

      <UiCard title="Snoozed">
        {snoozedAlerts.length === 0 ? (
          <p className="text-muted">No snoozed alerts.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {snoozedAlerts.map((row) => (
              <AlertCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </UiCard>

      <div className="flex items-start gap-2 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-muted">
        <span>
          Alerts are auto-generated when a milestone event or Opex installment reaches its due date. Snooze defers the next
          reminder without changing the underlying due date. Raise Invoice opens a draft invoice pre-filled from this alert.
        </span>
      </div>

      <Modal
        title="Snooze Alert"
        open={!!snoozeTarget}
        onCancel={() => setSnoozeTarget(null)}
        onOk={submitSnooze}
        confirmLoading={snoozeMutation.isPending}
        okButtonProps={{ disabled: !snoozeDate }}
      >
        <p className="mb-2 text-muted">Snooze until</p>
        <DateInput value={snoozeDate} onChange={setSnoozeDate} />
        <p className="mb-2 mt-3 text-muted">Note (optional)</p>
        <Input.TextArea rows={3} value={snoozeNote} onChange={(e) => setSnoozeNote(e.target.value)} />
      </Modal>
    </div>
  );
}
