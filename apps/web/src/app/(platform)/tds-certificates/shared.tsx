'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Table,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MoneyInput, StatusTag, UiCard } from '@zitaware/ui';
import { DatePicker } from '@/components/masked-date-picker';
import type {
  TaxDeductionType,
  TdsCertificateImportRow,
  TdsCertificateMatchRow,
  TdsCertificateSource,
  TdsMatchCandidate,
} from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { ClientSelect } from '@/components/client-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { formatDate, formatMoney } from '@/lib/format';
import { readCsv } from '@/lib/csv';

export const SOURCE_LABELS: Record<TdsCertificateSource, string> = {
  CERTIFICATE: 'Certificate (16A / GSTR-7A)',
  STATEMENT: 'Statement (26AS / GST portal)',
};
export const TYPE_LABELS: Record<TaxDeductionType, string> = {
  TDS: 'TDS',
  CGST_TDS: 'CGST-TDS',
  SGST_TDS: 'SGST-TDS',
  IGST_TDS: 'IGST-TDS',
};

const toIso = (d: dayjs.Dayjs | null | undefined) => (d ? d.format('YYYY-MM-DD') : '');

/** Record one certificate or statement credit by hand. */
export function RecordCertificateModal({
  open,
  onClose,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const record = trpc.tdsCertificates.record.useMutation({
    onSuccess: () => {
      message.success('Certificate recorded.');
      form.resetFields();
      onRecorded();
      onClose();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal
      title="Record TDS Certificate"
      open={open}
      onCancel={onClose}
      okText="Record"
      confirmLoading={record.isPending}
      onOk={() => form.submit()}
      width={640}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ source: 'CERTIFICATE', deductionType: 'TDS' }}
        onFinish={(v: Record<string, unknown>) =>
          record.mutate({
            legalEntityId: v.legalEntityId as string,
            partyId: v.partyId as string,
            source: v.source as TdsCertificateSource,
            deductionType: v.deductionType as TaxDeductionType,
            referenceNumber: v.referenceNumber as string,
            deductorTan: (v.deductorTan as string | undefined) || undefined,
            deductorGstin: (v.deductorGstin as string | undefined) || undefined,
            periodStart: toIso((v.period as [dayjs.Dayjs, dayjs.Dayjs])[0]),
            periodEnd: toIso((v.period as [dayjs.Dayjs, dayjs.Dayjs])[1]),
            creditDate: toIso(v.creditDate as dayjs.Dayjs),
            amount: v.amount as string,
            remarks: (v.remarks as string | undefined) || undefined,
          })
        }
      >
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <Form.Item name="legalEntityId" label="Legal Entity" rules={[{ required: true }]}>
            <LegalEntitySelect />
          </Form.Item>
          <Form.Item name="partyId" label="Client (Deductor)" rules={[{ required: true }]}>
            <ClientSelect includeInactive />
          </Form.Item>
          <Form.Item name="source" label="Source" rules={[{ required: true }]}>
            <Select
              options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="deductionType" label="Type" rules={[{ required: true }]}>
            <Select
              options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item
            name="referenceNumber"
            label="Certificate / Statement Reference"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="amount" label="Amount" rules={[{ required: true }]}>
            <MoneyInput className="w-full" min="0.01" />
          </Form.Item>
          <Form.Item name="period" label="Period" rules={[{ required: true }]}>
            <DatePicker.RangePicker className="w-full" />
          </Form.Item>
          <Form.Item name="creditDate" label="Credit Date" rules={[{ required: true }]}>
            <DatePicker className="w-full" />
          </Form.Item>
          <Form.Item name="deductorTan" label="Deductor TAN">
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="deductorGstin" label="Deductor GSTIN">
            <Input maxLength={20} />
          </Form.Item>
        </div>
        <Form.Item name="remarks" label="Remarks">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export const CSV_TEMPLATE =
  'source,deduction_type,client,deductor_tan,deductor_gstin,reference_number,period_start,period_end,credit_date,amount,remarks\n26AS,TDS,Client name or GSTIN,ABCD01234E,,26AS-REF-001,2026-07-01,2026-09-30,2026-07-10,10000.00,\n';

export function parseCertificateCsv(text: string): TdsCertificateImportRow[] {
  const lines = readCsv(text).filter((cells) => cells.some((c) => c !== ''));
  if (!lines.length) return [];
  const first = lines[0]!.join(',');
  const dataLines = /source/i.test(first) && /reference/i.test(first) ? lines.slice(1) : lines;
  return dataLines.map((c) => ({
    source: c[0] ?? '', deductionType: c[1] ?? '', client: c[2] ?? '', deductorTan: c[3] ?? '', deductorGstin: c[4] ?? '',
    referenceNumber: c[5] ?? '', periodStart: c[6] ?? '', periodEnd: c[7] ?? '', creditDate: c[8] ?? '', amount: c[9] ?? '', remarks: c[10] ?? '',
  }));
}

/** Upload a CSV in the template, preview every row, import all or nothing. */
export function ImportCertificatesModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { message } = App.useApp();
  const [legalEntityId, setLegalEntityId] = useState<string | undefined>();
  const [rows, setRows] = useState<TdsCertificateImportRow[]>([]);
  const preview = trpc.tdsCertificates.previewImport.useMutation({
    onError: (e) => message.error(e.message),
  });
  const importRows = trpc.tdsCertificates.importRows.useMutation({
    onSuccess: (r) => {
      message.success(`${r.created} certificate(s) imported.`);
      setRows([]);
      preview.reset();
      onImported();
      onClose();
    },
    onError: (e) => message.error(e.message),
  });

  const load = async (file: File) => {
    const parsed = parseCertificateCsv(await file.text());
    setRows(parsed);
    if (legalEntityId && parsed.length) preview.mutate({ legalEntityId, rows: parsed });
    return false;
  };
  const result = preview.data;
  const previewColumns: ColumnsType<TdsCertificateImportRow & { rowNumber: number }> = [
    { title: 'Row', dataIndex: 'rowNumber', key: 'rowNumber', width: 60 },
    { title: 'Reference', dataIndex: 'referenceNumber', key: 'referenceNumber' },
    {
      title: 'Client',
      key: 'client',
      render: (_v, r) => result?.rows[r.rowNumber - 1]?.clientName ?? r.client,
    },
    { title: 'Type', dataIndex: 'deductionType', key: 'deductionType' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right' },
    {
      title: 'Check',
      key: 'errors',
      render: (_v, r) => {
        const errors = result?.rows[r.rowNumber - 1]?.errors ?? [];
        return errors.length ? (
          <span className="text-negative">{errors.join(' ')}</span>
        ) : (
          <StatusTag status="OK" label="Ready" tone="pos" />
        );
      },
    },
  ];

  return (
    <Modal
      title="Import TDS Certificates (CSV)"
      open={open}
      onCancel={onClose}
      width={900}
      okText={result ? `Import ${result.validCount} row(s)` : 'Import'}
      okButtonProps={{ disabled: !result || result.errorCount > 0 || !legalEntityId }}
      confirmLoading={importRows.isPending}
      onOk={() => legalEntityId && importRows.mutate({ legalEntityId, rows })}
      destroyOnHidden
    >
      <p className="mt-0 text-[12.5px] text-muted">
        Columns: source (CERTIFICATE, 16A, GSTR-7A, STATEMENT, 26AS), deduction type (TDS, CGST_TDS,
        SGST_TDS, IGST_TDS), client name or GSTIN, deductor TAN, deductor GSTIN, reference, period
        start, period end, credit date (YYYY-MM-DD or DD/MM/YYYY), amount, remarks. A file with any
        bad row imports nothing.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-[260px]">
          <LegalEntitySelect
            placeholder="Legal entity"
            value={legalEntityId}
            onChange={setLegalEntityId}
            onUserChange={(v) => {
              if (v && rows.length) preview.mutate({ legalEntityId: v, rows });
            }}
          />
        </div>
        <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => load(file)}>
          <Button>Choose CSV</Button>
        </Upload>
        <Button
          type="link"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tds-certificates-template.csv';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download template
        </Button>
      </div>
      {result && result.errorCount > 0 ? (
        <Alert
          type="error"
          showIcon
          className="mb-3"
          message={`${result.errorCount} row(s) need fixing before anything can be imported.`}
        />
      ) : null}
      <Table
        rowKey="rowNumber"
        size="small"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        loading={preview.isPending}
        columns={previewColumns}
        dataSource={rows.map((r, i) => ({ ...r, rowNumber: i + 1 }))}
        tableLayout="auto" scroll={{ x: true }}
        locale={{
          emptyText: legalEntityId
            ? 'Choose a CSV file.'
            : 'Choose the legal entity, then a CSV file.',
        }}
      />
    </Modal>
  );
}

/** One certificate: its figures, what it is matched to, and matching more. */
export function CertificateDrawer({
  id,
  onClose,
  canManage,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { message, modal } = App.useApp();
  const utils = trpc.useUtils();
  const detail = trpc.tdsCertificates.getDetail.useQuery(
    { id: id ?? '' },
    { enabled: Boolean(id) },
  );
  const candidates = trpc.tdsCertificates.listMatchCandidates.useQuery(
    { certificateId: id ?? '' },
    { enabled: Boolean(id) && canManage && detail.data?.status === 'ACTIVE' },
  );
  const [amounts, setAmounts] = useState<Record<string, string | undefined>>({});
  const refresh = () => {
    void utils.tdsCertificates.getDetail.invalidate();
    void utils.tdsCertificates.listMatchCandidates.invalidate();
    onChanged();
  };
  const match = trpc.tdsCertificates.match.useMutation({
    onSuccess: () => {
      message.success('Matched.');
      setAmounts({});
      refresh();
    },
    onError: (e) => message.error(e.message),
  });
  const unmatch = trpc.tdsCertificates.unmatch.useMutation({
    onSuccess: refresh,
    onError: (e) => message.error(e.message),
  });
  const cancel = trpc.tdsCertificates.cancel.useMutation({
    onSuccess: refresh,
    onError: (e) => message.error(e.message),
  });
  const d = detail.data;

  const askReason = (title: string, onReason: (reason: string) => void) => {
    let reason = '';
    modal.confirm({
      title,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="Reason (required)"
          onChange={(e) => (reason = e.target.value)}
        />
      ),
      okText: 'Confirm',
      onOk: () => {
        if (reason.trim().length < 3) {
          message.error('Give a reason.');
          return Promise.reject(new Error('reason required'));
        }
        onReason(reason.trim());
        return undefined;
      },
    });
  };

  const selected = useMemo(
    () => Object.entries(amounts).filter(([, v]) => v && Number(v) > 0) as Array<[string, string]>,
    [amounts],
  );

  const matchColumns: ColumnsType<TdsCertificateMatchRow> = [
    {
      title: 'Receipt',
      dataIndex: 'receiptDate',
      key: 'receiptDate',
      render: (v: string, r) => (
        <Link
          href={`/projects/${r.projectId}/receipts/${r.receiptId}`}
          className="text-brand hover:underline"
        >
          {formatDate(v)}
        </Link>
      ),
    },
    {
      title: 'Invoice',
      key: 'invoice',
      render: (_v, r) => (
        <Link
          href={`/projects/${r.projectId}/invoices/${r.invoiceId}`}
          className="text-brand hover:underline"
        >
          {r.invoiceNumber ?? '—'}
        </Link>
      ),
    },
    { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
    {
      title: 'Amount',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: string) => formatMoney(v),
    },
    {
      title: '',
      key: 'status',
      render: (_v, r) =>
        r.unmatchedAt ? (
          <span className="text-muted" title={r.unmatchReason ?? ''}>
            Unmatched {formatDate(r.unmatchedAt)}
          </span>
        ) : canManage ? (
          <Button
            size="small"
            onClick={() =>
              askReason('Unmatch this deduction?', (reason) =>
                unmatch.mutate({ matchId: r.id, reason }),
              )
            }
          >
            Unmatch
          </Button>
        ) : null,
    },
  ];
  const candidateColumns: ColumnsType<TdsMatchCandidate> = [
    {
      title: 'Receipt',
      dataIndex: 'receiptDate',
      key: 'receiptDate',
      render: (v: string, r) => (
        <span>
          {formatDate(v)}
          {r.inPeriod ? '' : <span className="ml-1 text-warning">(outside period)</span>}
        </span>
      ),
    },
    {
      title: 'Invoice',
      dataIndex: 'invoiceNumber',
      key: 'invoiceNumber',
      render: (v: string | null) => v ?? '—',
    },
    { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
    {
      title: 'Deducted',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: string) => formatMoney(v),
    },
    {
      title: 'Left to Match',
      dataIndex: 'remaining',
      key: 'remaining',
      align: 'right',
      render: (v: string) => formatMoney(v),
    },
    {
      title: 'Match',
      key: 'match',
      width: 170,
      render: (_v, r) => (
        <MoneyInput
          size="small"
          className="w-full"
          min="0"
          max={r.remaining}
          value={amounts[r.deductionId] ?? null}
          placeholder={r.remaining}
          onChange={(v) => setAmounts({ ...amounts, [r.deductionId]: v ?? undefined })}
        />
      ),
    },
  ];

  return (
    <Drawer
      title={d ? `${TYPE_LABELS[d.deductionType]} · ${d.referenceNumber}` : 'TDS Certificate'}
      open={Boolean(id)}
      onClose={onClose}
      width={900}
      destroyOnHidden
    >
      {detail.isError ? <Alert type="error" showIcon message={detail.error.message} /> : null}
      {d ? (
        <>
          <div className="mb-4">
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Client">{d.partyName}</Descriptions.Item>
              <Descriptions.Item label="Legal Entity">{d.legalEntityName}</Descriptions.Item>
              <Descriptions.Item label="Source">{SOURCE_LABELS[d.source]}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <StatusTag
                  status={d.status}
                  label={d.status === 'ACTIVE' ? 'Active' : 'Cancelled'}
                  tone={d.status === 'ACTIVE' ? 'pos' : 'mut'}
                />
              </Descriptions.Item>
              <Descriptions.Item label="Period">
                {formatDate(d.periodStart)} – {formatDate(d.periodEnd)}
              </Descriptions.Item>
              <Descriptions.Item label="Credit Date">{formatDate(d.creditDate)}</Descriptions.Item>
              <Descriptions.Item label="Deductor TAN">{d.deductorTan ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Deductor GSTIN">{d.deductorGstin ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Amount">{formatMoney(d.amount)}</Descriptions.Item>
              <Descriptions.Item label="Unmatched">
                {formatMoney(d.unmatchedAmount)}
              </Descriptions.Item>
              {d.cancelReason ? (
                <Descriptions.Item label="Cancel Reason" span={2}>
                  {d.cancelReason}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </div>

          <UiCard title="Matched Deductions" flush className="mb-4">
            <Table<TdsCertificateMatchRow>
              rowKey="id"
              size="small"
              pagination={false}
              columns={matchColumns}
              dataSource={d.matches}
              tableLayout="auto" scroll={{ x: true }}
              locale={{ emptyText: 'Not matched to any deduction yet.' }}
            />
          </UiCard>

          {canManage && d.status === 'ACTIVE' ? (
            <UiCard
              title="Match to Deductions"
              flush
              className="mb-4"
              actions={
                <Button
                  type="primary"
                  disabled={!selected.length}
                  loading={match.isPending}
                  onClick={() =>
                    match.mutate({
                      certificateId: d.id,
                      matches: selected.map(([deductionId, amount]) => ({ deductionId, amount })),
                    })
                  }
                >
                  Match Selected
                </Button>
              }
            >
              <Table<TdsMatchCandidate>
                rowKey="deductionId"
                size="small"
                pagination={false}
                loading={candidates.isLoading}
                columns={candidateColumns}
                dataSource={candidates.data ?? []}
                tableLayout="auto" scroll={{ x: true }}
                locale={{
                  emptyText: `No unmatched ${TYPE_LABELS[d.deductionType]} deductions by ${d.partyName}.`,
                }}
              />
            </UiCard>
          ) : null}

          {canManage && d.status === 'ACTIVE' ? (
            <Button
              danger
              onClick={() =>
                askReason('Cancel this certificate?', (reason) =>
                  cancel.mutate({ id: d.id, reason, expectedVersion: d.version }),
                )
              }
            >
              Cancel Certificate
            </Button>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
