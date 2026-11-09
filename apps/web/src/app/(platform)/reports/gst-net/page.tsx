'use client';

import { useState } from 'react';
import { Alert, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { KpiCard, PageHeader, UiCard } from '@zitaware/ui';
import type { GstAdjustmentRow, GstNetLine, GstNetPeriodRow, ReportFilters } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { ExportButtons, ReconciliationCard, ReportBasisNote, ReportFilterBar, defaultPeriodFilters, signedMoney } from '../shared';
import { JournalLink, taxPeriodLabel } from '../gst-links';

const netColumns = <T extends { output: string; eligibleInput: string; adjustments: string; net: string }>(): ColumnsType<T> => [
  { title: 'Output GST', dataIndex: 'output', key: 'output', align: 'right', render: signedMoney },
  { title: 'Eligible Input GST', dataIndex: 'eligibleInput', key: 'eligibleInput', align: 'right', render: signedMoney },
  { title: 'Adjustments', dataIndex: 'adjustments', key: 'adjustments', align: 'right', render: signedMoney },
  { title: 'Net', dataIndex: 'net', key: 'net', align: 'right', render: (v: string) => <b>{signedMoney(v)}</b> },
];

const componentColumns: ColumnsType<GstNetLine> = [{ title: 'Component', dataIndex: 'label', key: 'label' }, ...netColumns<GstNetLine>()];
const periodColumns: ColumnsType<GstNetPeriodRow> = [{ title: 'Tax Period', dataIndex: 'taxPeriod', key: 'taxPeriod', render: taxPeriodLabel }, ...netColumns<GstNetPeriodRow>()];
const adjustmentColumns: ColumnsType<GstAdjustmentRow> = [
  { title: 'Date', dataIndex: 'accountingDate', key: 'accountingDate', render: (v: string) => formatDate(v) },
  { title: 'Posted By', dataIndex: 'sourceType', key: 'sourceType' },
  { title: 'Description', dataIndex: 'description', key: 'description', render: (v: string | null) => v ?? '—' },
  { title: 'Ledger Account', dataIndex: 'ledgerAccountName', key: 'ledgerAccountName' },
  { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: signedMoney },
  { title: '', key: 'journal', render: (_v, r) => <JournalLink journalEntryId={r.journalEntryId} /> },
];

/** GST Net — docs/04 §16: output − eligible input ± adjustments; components equal the net and the ledger. */
export default function GstNetPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultPeriodFilters);
  const report = trpc.reports.gstNet.useQuery(filters);
  const data = report.data;
  const t = data?.totals;

  return (
    <>
      <PageHeader title="GST Net" description="Output GST less eligible input GST, with adjustments, per component and month." actions={<ExportButtons reportKey="gst-net" filters={filters} />} />

      <UiCard flush className="mb-4">
        <ReportFilterBar applied={filters} onApply={setFilters} period />
      </UiCard>

      {report.isError ? <Alert type="error" showIcon className="mb-4" message={report.error.message} /> : null}
      {data ? <ReportBasisNote catalog={data.catalog} scope={data.scope} /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Output GST" value={formatMoney(t?.output ?? null)} />
        <KpiCard label="Eligible Input GST" value={formatMoney(t?.eligibleInput ?? null)} />
        <KpiCard label="Adjustments" value={formatMoney(t?.adjustments ?? null)} sub="GST postings no document explains" />
        <KpiCard label="Net GST" value={formatMoney(t?.net ?? null)} sub="Output − input + adjustments" />
      </div>

      <UiCard title="By Component" flush className="mb-4">
        <Table<GstNetLine>
          rowKey="component"
          size="small"
          pagination={false}
          loading={report.isLoading}
          columns={componentColumns}
          dataSource={data?.components ?? []}
          tableLayout="auto" scroll={{ x: true }}
          summary={() =>
            t ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>
                  <b>{t.label}</b>
                </Table.Summary.Cell>
                {[t.output, t.eligibleInput, t.adjustments, t.net].map((v, i) => (
                  <Table.Summary.Cell key={i} index={i + 1} align="right">
                    <b>{signedMoney(v)}</b>
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            ) : null
          }
        />
        <p className="m-0 border-t border-ui-2 px-4 py-3 text-[12px] text-muted">
          A negative net is input credit exceeding output. This is not a return: GST-TDS credits and cross-utilisation rules are not applied here.
        </p>
      </UiCard>

      <UiCard title="By Tax Period" flush className="mb-4">
        <Table<GstNetPeriodRow> rowKey="taxPeriod" size="small" pagination={false} loading={report.isLoading} columns={periodColumns} dataSource={data?.periods ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No GST in this period.' }} />
      </UiCard>

      <UiCard title="Adjustments" flush className="mb-4">
        <Table<GstAdjustmentRow> rowKey={(r) => `${r.journalEntryId}-${r.ledgerAccountCode}`} size="small" pagination={false} loading={report.isLoading} columns={adjustmentColumns} dataSource={data?.adjustments ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'No adjustments — every GST posting in this period came from an invoice, note, bill, expense or claim.' }} />
      </UiCard>

      {data ? <ReconciliationCard reconciliation={data.reconciliation} /> : null}
    </>
  );
}
