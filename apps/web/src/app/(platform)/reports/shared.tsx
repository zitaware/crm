'use client';

import { useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { Alert, App, Button, Select, Table } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { FilterCard, FilterField, StatusTag, UiCard, type StatusTagTone } from '@zitaware/ui';
import { REPORT_BASIS_LABELS } from '@zitaware/contracts/reports';
import type {
  AgingBucket,
  LedgerReconciliation,
  LedgerReconciliationLine,
  OutstandingDeductionType,
  ReportCatalogEntry,
  ReportFilters,
  ReportKey,
  ReportScope,
} from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { fromBase64 } from '@/lib/document-crypto';
import { formatDate, formatMoney } from '@/lib/format';

// Display labels only. Which bucket a row falls in, and every amount, is
// computed by the server (docs/04 §16: "As-of computation is backend-owned").
export const AGING_LABELS: Record<AgingBucket, string> = {
  NOT_DUE: 'Not Due',
  DAYS_0_30: '0–30 Days',
  DAYS_31_60: '31–60 Days',
  DAYS_61_90: '61–90 Days',
  DAYS_90_PLUS: '90+ Days',
};

const AGING_TONES: Record<AgingBucket, StatusTagTone> = {
  NOT_DUE: 'mut',
  DAYS_0_30: 'info',
  DAYS_31_60: 'warn',
  DAYS_61_90: 'neg',
  DAYS_90_PLUS: 'neg',
};

export const DEDUCTION_LABELS: Record<OutstandingDeductionType, string> = {
  TDS: 'TDS',
  CGST_TDS: 'CGST-TDS',
  SGST_TDS: 'SGST-TDS',
  IGST_TDS: 'IGST-TDS',
  HOLD: 'Hold',
  RETENTION: 'Retention',
  DISPUTED_PENALTY: 'Disputed Penalty',
};

export function AgingTag({ bucket }: { bucket: AgingBucket }) {
  return <StatusTag status={bucket} label={AGING_LABELS[bucket]} tone={AGING_TONES[bucket]} />;
}

export function money(value: string) {
  return <span className="tabular-nums">{formatMoney(value)}</span>;
}

/** A server-computed amount that may be negative (shown in the negative tone) or absent. */
export function signedMoney(value: string | null) {
  if (value === null) return <span className="text-muted-2">—</span>;
  return <span className={`tabular-nums ${value.startsWith('-') ? 'text-negative' : ''}`}>{formatMoney(value)}</span>;
}

/** A server-computed percentage, or a dash when it has no base. */
export function percent(value: string | null) {
  return value === null ? <span className="text-muted-2">—</span> : <span className="tabular-nums">{value}%</span>;
}

export function InvoiceLink({ projectId, invoiceId, label }: { projectId: string; invoiceId: string; label: string }) {
  return (
    <Link href={`/projects/${projectId}/invoices/${invoiceId}`} className="font-semibold text-brand hover:underline">
      {label}
    </Link>
  );
}

export function ReceiptLink({ projectId, receiptId, label }: { projectId: string; receiptId: string; label: string }) {
  return (
    <Link href={`/projects/${projectId}/receipts/${receiptId}`} className="text-brand hover:underline">
      {label}
    </Link>
  );
}

export function defaultFilters(): ReportFilters {
  return { legalEntityId: undefined, dateFrom: undefined, asOfDate: dayjs().format('YYYY-MM-DD'), clientId: undefined, projectId: undefined };
}

/** Period reports default to the current Indian financial year to date (1 April). */
export function defaultPeriodFilters(): ReportFilters {
  const today = dayjs();
  const fyStartYear = today.month() >= 3 ? today.year() : today.year() - 1;
  return { ...defaultFilters(), dateFrom: `${fyStartYear}-04-01` };
}

/** The filters every receivables report takes; the export uses the applied set, so it matches the screen. */
export function ReportFilterBar({ applied, onApply, period = false }: { applied: ReportFilters; onApply: (filters: ReportFilters) => void; period?: boolean }) {
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false });
  const clients = trpc.clients.list.useQuery({ includeInactive: true });
  const projects = trpc.projects.list.useQuery();
  const [draft, setDraft] = useState<ReportFilters>(applied);

  const reset = () => {
    const next = period ? defaultPeriodFilters() : defaultFilters();
    setDraft(next);
    onApply(next);
  };

  return (
    <FilterCard
      actions={
        <>
          <Button onClick={reset}>Reset</Button>
          <Button type="primary" onClick={() => onApply(draft)}>
            Apply
          </Button>
        </>
      }
    >
      {period ? (
        <FilterField label="From">
          <DatePicker
            allowClear
            placeholder="Beginning"
            value={draft.dateFrom ? dayjs(draft.dateFrom) : null}
            onChange={(date) => setDraft({ ...draft, dateFrom: date ? date.format('YYYY-MM-DD') : undefined })}
            className="w-[160px]"
          />
        </FilterField>
      ) : null}
      <FilterField label={period ? 'To' : 'As Of'}>
        <DatePicker
          allowClear={false}
          value={dayjs(draft.asOfDate)}
          onChange={(date) => date && setDraft({ ...draft, asOfDate: date.format('YYYY-MM-DD') })}
          className="w-[160px]"
        />
      </FilterField>
      <FilterField label="Legal Entity">
        <Select
          allowClear
          placeholder="All legal entities"
          value={draft.legalEntityId}
          onChange={(value?: string) => setDraft({ ...draft, legalEntityId: value })}
          loading={legalEntities.isLoading}
          className="w-[220px]"
          options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: e.legalName }))}
        />
      </FilterField>
      <FilterField label="Client">
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="All clients"
          value={draft.clientId}
          onChange={(value?: string) => setDraft({ ...draft, clientId: value, projectId: undefined })}
          loading={clients.isLoading}
          className="w-[220px]"
          options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
      </FilterField>
      <FilterField label="Project">
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="All projects"
          value={draft.projectId}
          onChange={(value?: string) => setDraft({ ...draft, projectId: value })}
          loading={projects.isLoading}
          className="w-[240px]"
          options={(projects.data ?? []).filter((p) => !draft.clientId || p.clientId === draft.clientId).map((p) => ({ value: p.id, label: p.name }))}
        />
      </FilterField>
    </FilterCard>
  );
}

/** Legal entity, as-of date, currency and basis — shown on every financial report (docs/04 §16). */
export function ReportBasisNote({ catalog, scope }: { catalog: ReportCatalogEntry; scope: ReportScope }) {
  const isPastDate = scope.asOfDate < dayjs().format('YYYY-MM-DD');
  return (
    <div className="mb-4 rounded-ui border border-ui bg-surface px-4 py-3 text-[12.5px] text-muted shadow-ui">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusTag status={catalog.basis} label={REPORT_BASIS_LABELS[catalog.basis]} tone="info" />
        {scope.dateFrom ? (
          <span>
            <b className="text-ink">Period</b> {formatDate(scope.dateFrom)} – {formatDate(scope.asOfDate)}
          </span>
        ) : (
          <span>
            <b className="text-ink">As of</b> {formatDate(scope.asOfDate)}
          </span>
        )}
        <span>
          <b className="text-ink">Legal entity</b> {scope.legalEntityName ?? 'All legal entities'}
        </span>
        {scope.clientName ? (
          <span>
            <b className="text-ink">Client</b> {scope.clientName}
          </span>
        ) : null}
        {scope.projectName ? (
          <span>
            <b className="text-ink">Project</b> {scope.projectName}
          </span>
        ) : null}
        <span>
          <b className="text-ink">Currency</b> {scope.currency}
        </span>
      </div>
      <div className="mt-1">
        {catalog.basisLabel}
        {isPastDate ? ' A document dated on or before this date but posted later still changes these figures, until its period is locked.' : ''}
      </div>
    </div>
  );
}

/** Report totals against the ledger's control accounts — Phase 8's exit criterion (docs/11). */
export function ReconciliationCard({ reconciliation }: { reconciliation: LedgerReconciliation }) {
  if (!reconciliation.applicable) {
    return <Alert type="info" showIcon className="mb-4" message="Not compared with the ledger" description={reconciliation.notApplicableReason} />;
  }
  const columns: ColumnsType<LedgerReconciliationLine> = [
    { title: 'Figure', dataIndex: 'label', key: 'label' },
    {
      title: 'Ledger Account',
      key: 'accounts',
      render: (_v, line) =>
        line.ledgerAccounts.length ? (
          line.ledgerAccounts.map((a) => (
            <Link key={a.id} href={`/chart-of-accounts/ledger/${a.id}`} className="mr-3 text-brand hover:underline">
              {a.name}
            </Link>
          ))
        ) : (
          <span className="text-muted-2">No such account</span>
        ),
    },
    { title: 'Report Total', dataIndex: 'reportAmount', key: 'reportAmount', align: 'right', render: money },
    { title: 'Ledger Balance', dataIndex: 'ledgerAmount', key: 'ledgerAmount', align: 'right', render: money },
    { title: 'Difference', dataIndex: 'difference', key: 'difference', align: 'right', render: money },
    {
      title: 'Status',
      key: 'status',
      render: (_v, line) => <StatusTag status={line.reconciled ? 'AGREES' : 'DIFFERS'} label={line.reconciled ? 'Agrees' : 'Differs'} tone={line.reconciled ? 'pos' : 'neg'} />,
    },
  ];
  return (
    <UiCard title="Ledger Reconciliation" flush className="mb-4">
      {!reconciliation.allReconciled ? (
        <Alert
          type="error"
          showIcon
          banner
          message="These totals do not agree with the ledger. Treat the report as unreconciled until the difference is explained."
        />
      ) : null}
      <Table<LedgerReconciliationLine> rowKey="key" size="small" pagination={false} columns={columns} dataSource={reconciliation.lines} tableLayout="auto" scroll={{ x: true }} />
    </UiCard>
  );
}

function downloadBase64File(filename: string, mimeType: string, base64: string) {
  const bytes = fromBase64(base64);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Excel and PDF of exactly what is on screen; each download is audited. Hidden without `report.export`. */
export function ExportButtons({ reportKey, filters }: { reportKey: ReportKey; filters: ReportFilters }) {
  const { message } = App.useApp();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const exportReport = trpc.reports.export.useMutation({
    onSuccess: (result) => downloadBase64File(result.filename, result.mimeType, result.base64),
    onError: (error) => message.error(error.message),
  });
  if (!permissions.includes('report.export')) return null;

  const pendingFormat = exportReport.isPending ? exportReport.variables?.format : undefined;
  return (
    <>
      <Button loading={pendingFormat === 'XLSX'} disabled={exportReport.isPending} onClick={() => exportReport.mutate({ key: reportKey, format: 'XLSX', filters })}>
        Export Excel
      </Button>
      <Button loading={pendingFormat === 'PDF'} disabled={exportReport.isPending} onClick={() => exportReport.mutate({ key: reportKey, format: 'PDF', filters })}>
        Export PDF
      </Button>
    </>
  );
}
