'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Button, Drawer, Form, Modal, Select, Table, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { StatusTag, type StatusTagTone } from '@zitaware/ui';
import { BANK_STATEMENT_DATE_FORMAT_LABELS } from '@zitaware/contracts/bank-reconciliation';
import type { BankExceptionStatus, BankLineStatus, BankStatementAmountMode, BankStatementCsv, BankStatementDateFormat, BankStatementPreviewRow, BankStatementProfile } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { readCsv } from '@/lib/csv';
import { formatDate, formatMoney } from '@/lib/format';

const STATUS: Record<BankLineStatus, { label: string; tone: StatusTagTone }> = {
  UNMATCHED: { label: 'Unmatched', tone: 'warn' },
  PARTIALLY_MATCHED: { label: 'Partly Matched', tone: 'info' },
  MATCHED: { label: 'Matched', tone: 'pos' },
};
export function LineStatusTag({ status, exception }: { status: BankLineStatus; exception?: BankExceptionStatus }) {
  if (exception === 'APPROVED') return <StatusTag status="EXCEPTION" label="Exception (approved)" tone="mut" />;
  if (exception === 'PENDING_APPROVAL') return <StatusTag status="EXCEPTION_PENDING" label="Exception (awaiting approval)" tone="neg" />;
  return <StatusTag status={status} label={STATUS[status].label} tone={STATUS[status].tone} />;
}

export function signed(value: string) {
  return <span className={`tabular-nums ${value.startsWith('-') ? 'text-negative' : 'text-positive'}`}>{formatMoney(value)}</span>;
}

/** Reads a file into the header cells and data rows the server maps and validates. */
export async function readStatementFile(file: File): Promise<BankStatementCsv> {
  const cells = readCsv(await file.text());
  const [headers = [], ...rows] = cells;
  return { fileName: file.name, headers, rows };
}

const AMOUNT_MODES: Record<BankStatementAmountMode, string> = {
  DEBIT_CREDIT_COLUMNS: 'Separate withdrawal and deposit columns',
  SIGNED_AMOUNT: 'One amount column (negative = withdrawal)',
  AMOUNT_WITH_INDICATOR: 'One amount column with a Dr/Cr column',
};

/** Maps a bank's CSV columns once per account; the headers come from a sample file. */
export function ColumnMappingDrawer({ bankAccountId, profile, headers, open, onClose, onSaved }: { bankAccountId: string; profile: BankStatementProfile | null; headers: string[]; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const mode = Form.useWatch<BankStatementAmountMode | undefined>('amountMode', form);
  const save = trpc.bankReconciliation.saveProfile.useMutation({
    onSuccess: () => {
      message.success('Column mapping saved.');
      onSaved();
      onClose();
    },
    onError: (e) => message.error(e.message),
  });
  useEffect(() => {
    if (open) form.setFieldsValue(profile ?? { amountMode: 'DEBIT_CREDIT_COLUMNS', dateFormat: 'DD_MM_YYYY_SLASH' });
  }, [open, profile, form]);

  const known = new Set(headers);
  const columnOptions = [...headers, ...Object.values(profile ?? {}).filter((v): v is string => typeof v === 'string' && !known.has(v) && v.length < 200)]
    .filter((v, i, all) => v && all.indexOf(v) === i)
    .map((h) => ({ value: h, label: h }));
  const column = (name: string, label: string, required = false) => (
    <Form.Item name={name} label={label} rules={required ? [{ required: true, message: `Choose the ${label.toLowerCase()} column` }] : []}>
      <Select allowClear={!required} showSearch options={columnOptions} placeholder={headers.length ? 'Choose a column' : 'Choose a CSV file first'} />
    </Form.Item>
  );

  return (
    <Drawer
      title="Map Statement Columns"
      open={open}
      onClose={onClose}
      width={560}
      destroyOnHidden
      extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>Save Mapping</Button>}
    >
      {!headers.length ? <Alert type="info" showIcon className="mb-3" message="Choose a statement CSV in the import dialog first — its header row supplies the column names." /> : null}
      <Form
        form={form}
        layout="vertical"
        onFinish={(v: Record<string, string | undefined>) =>
          save.mutate({
            bankAccountId,
            expectedVersion: profile?.version,
            dateColumn: v.dateColumn!,
            dateFormat: v.dateFormat as BankStatementDateFormat,
            descriptionColumn: v.descriptionColumn!,
            referenceColumn: v.referenceColumn,
            amountMode: v.amountMode as BankStatementAmountMode,
            debitColumn: v.debitColumn,
            creditColumn: v.creditColumn,
            amountColumn: v.amountColumn,
            indicatorColumn: v.indicatorColumn,
            creditIndicator: v.creditIndicator,
            balanceColumn: v.balanceColumn,
          })
        }
      >
        {column('dateColumn', 'Date', true)}
        <Form.Item name="dateFormat" label="Date Format" rules={[{ required: true }]}>
          <Select options={Object.entries(BANK_STATEMENT_DATE_FORMAT_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        {column('descriptionColumn', 'Description', true)}
        {column('referenceColumn', 'Reference')}
        <Form.Item name="amountMode" label="Amounts" rules={[{ required: true }]}>
          <Select options={Object.entries(AMOUNT_MODES).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        {mode === 'DEBIT_CREDIT_COLUMNS' ? (
          <>
            {column('debitColumn', 'Withdrawal', true)}
            {column('creditColumn', 'Deposit', true)}
          </>
        ) : (
          column('amountColumn', 'Amount', true)
        )}
        {mode === 'AMOUNT_WITH_INDICATOR' ? (
          <>
            {column('indicatorColumn', 'Dr/Cr Indicator', true)}
            <Form.Item name="creditIndicator" label="Value Meaning Money In" initialValue="CR">
              <Select options={['CR', 'C', 'CREDIT', 'DEPOSIT'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </>
        ) : null}
        {column('balanceColumn', 'Balance')}
      </Form>
    </Drawer>
  );
}

/** Choose a file, preview every row, import all or nothing. */
export function ImportStatementModal({ bankAccountId, profile, open, onClose, onImported }: { bankAccountId: string; profile: BankStatementProfile | null; open: boolean; onClose: () => void; onImported: () => void }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [file, setFile] = useState<BankStatementCsv | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const preview = trpc.bankReconciliation.previewImport.useMutation({ onError: (e) => message.error(e.message) });
  const importStatement = trpc.bankReconciliation.importStatement.useMutation({
    onSuccess: (r) => {
      message.success(`${r.created} line(s) imported${r.duplicates ? `, ${r.duplicates} already imported` : ''}.`);
      setFile(null);
      preview.reset();
      onImported();
      onClose();
    },
    onError: (e) => message.error(e.message),
  });
  const result = preview.data;

  const columns: ColumnsType<BankStatementPreviewRow> = [
    { title: 'Row', dataIndex: 'rowNumber', key: 'rowNumber', width: 60 },
    { title: 'Date', dataIndex: 'transactionDate', key: 'transactionDate', render: (v: string | null) => (v ? formatDate(v) : '—') },
    { title: 'Description', dataIndex: 'description', key: 'description' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string | null) => (v ? signed(v) : '—') },
    {
      title: 'Check',
      key: 'outcome',
      render: (_v, r) =>
        r.outcome === 'ERROR' ? (
          <span className="text-negative">{r.errors.join(' ')}</span>
        ) : (
          <StatusTag status={r.outcome} label={{ READY: 'Ready', DUPLICATE: 'Already imported', SKIPPED: 'Skipped' }[r.outcome]} tone={r.outcome === 'READY' ? 'pos' : 'mut'} />
        ),
    },
  ];

  return (
    <Modal
      title="Import Bank Statement"
      open={open}
      onCancel={onClose}
      width={960}
      okText={result ? `Import ${result.readyCount} line(s)` : 'Import'}
      okButtonProps={{ disabled: !file || !result || result.errorCount > 0 || result.readyCount === 0 }}
      confirmLoading={importStatement.isPending}
      onOk={() => file && importStatement.mutate({ bankAccountId, ...file })}
      destroyOnHidden
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Upload
          accept=".csv,text/csv"
          showUploadList={false}
          beforeUpload={async (f) => {
            const read = await readStatementFile(f);
            setFile(read);
            if (profile) preview.mutate({ bankAccountId, ...read });
            return false;
          }}
        >
          <Button>Choose CSV</Button>
        </Upload>
        <span className="text-[12.5px] text-muted">{file ? `${file.fileName} · ${file.rows.length} rows` : 'Export the statement from your bank as CSV.'}</span>
        <Button type="link" onClick={() => setMappingOpen(true)}>
          {profile ? 'Edit column mapping' : 'Map columns'}
        </Button>
      </div>
      {!profile ? <Alert type="warning" showIcon className="mb-3" message="Map this account's CSV columns once before importing." /> : null}
      {result ? (
        <Alert
          type={result.errorCount ? 'error' : 'info'}
          showIcon
          className="mb-3"
          message={`${result.readyCount} ready · ${result.duplicateCount} already imported · ${result.skippedCount} skipped · ${result.errorCount} with errors${result.firstDate ? ` · ${formatDate(result.firstDate)} – ${formatDate(result.lastDate!)}` : ''}`}
          description={`Money in ${formatMoney(result.totalIn)} · money out ${formatMoney(result.totalOut)}${result.errorCount ? ' — fix the rows in error; nothing is imported while any remain.' : ''}`}
        />
      ) : null}
      <Table<BankStatementPreviewRow> rowKey="rowNumber" size="small" pagination={{ pageSize: 20, hideOnSinglePage: true }} loading={preview.isPending} columns={columns} dataSource={result?.rows ?? []} tableLayout="auto" scroll={{ x: true }} locale={{ emptyText: 'Choose a CSV file to preview it.' }} />
      <ColumnMappingDrawer
        bankAccountId={bankAccountId}
        profile={profile}
        headers={file?.headers ?? []}
        open={mappingOpen}
        onClose={() => setMappingOpen(false)}
        onSaved={() => {
          void utils.bankReconciliation.getWorkspace.invalidate();
          if (file) preview.mutate({ bankAccountId, ...file });
        }}
      />
    </Modal>
  );
}
