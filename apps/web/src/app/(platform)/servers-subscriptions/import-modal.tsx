'use client';

import { useState } from 'react';
import { Alert, App, Button, Modal, Select, Table, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { StatusTag } from '@zitaware/ui';
import type { ServerSubscriptionImportChoice, ServerSubscriptionImportRow } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { downloadWorkbook } from '../employees/import-modal';
import { newIdempotencyKey, SPEND_TYPE_LABEL } from '../direct-expenses/shared';

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Upload the sheet, see every row checked against the masters, pick the
 * employee where a name repeats, then post them all (ADR-169). Every figure
 * and error comes from the API; the page only shows them.
 */
export function ImportServerSubscriptionsModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => Promise<void> }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [contentBase64, setContentBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [choices, setChoices] = useState<ServerSubscriptionImportChoice[]>([]);
  const [importKey, setImportKey] = useState(newIdempotencyKey());
  const [sampleLoading, setSampleLoading] = useState(false);

  const preview = trpc.directExpenses.previewImport.useMutation({ onError: (error) => message.error(error.message) });
  const reset = () => {
    setContentBase64(null);
    setFileName(null);
    setChoices([]);
    setImportKey(newIdempotencyKey());
    preview.reset();
  };
  const importRows = trpc.directExpenses.importRows.useMutation({
    onSuccess: async (result) => {
      message.success(`${result.created} bill(s) posted, ${formatMoney(result.totalAmount)} in all.`);
      reset();
      await onImported();
      onClose();
    },
    onError: (error) => message.error(error.message),
  });

  const close = () => {
    reset();
    onClose();
  };

  const downloadSample = async () => {
    setSampleLoading(true);
    try {
      const file = await utils.directExpenses.importSample.fetch();
      downloadWorkbook(file.contentBase64, file.filename);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not download the sample.');
    } finally {
      setSampleLoading(false);
    }
  };

  const load = async (file: File) => {
    const encoded = await fileToBase64(file);
    setContentBase64(encoded);
    setFileName(file.name);
    setChoices([]);
    setImportKey(newIdempotencyKey());
    preview.mutate({ contentBase64: encoded, choices: [] });
    return false;
  };

  /** A choice re-checks the sheet, so the totals and errors stay the API's. */
  const choose = (rowNumber: number, change: Omit<ServerSubscriptionImportChoice, 'rowNumber'>) => {
    const next = [...choices.filter((c) => c.rowNumber !== rowNumber), { ...choices.find((c) => c.rowNumber === rowNumber), ...change, rowNumber }];
    setChoices(next);
    if (contentBase64) preview.mutate({ contentBase64, choices: next });
  };

  const result = preview.data;
  const columns: ColumnsType<ServerSubscriptionImportRow> = [
    { title: 'Row', dataIndex: 'rowNumber', key: 'rowNumber', width: 56 },
    {
      title: 'Employee',
      key: 'employee',
      width: 220,
      render: (_v, row) =>
        row.employeeChoices.length > 1 ? (
          <div>
            <div className="mb-1 text-[11.5px] text-warning">{row.employeeChoices.length} employees named &ldquo;{row.employeeName}&rdquo;. Which one?</div>
            <Select
              size="small"
              className="w-full"
              placeholder="Choose by employee code"
              {...(row.employeeId ? { value: row.employeeId } : {})}
              onChange={(employeeId: string) => choose(row.rowNumber, { employeeId })}
              options={row.employeeChoices.map((e) => ({ value: e.id, label: `${e.employeeCode} · ${e.fullName}` }))}
            />
          </div>
        ) : (
          row.employeeName || '—'
        ),
    },
    {
      title: 'Bill',
      key: 'title',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">{row.title || '—'}</div>
          <div className="text-[11.5px] text-muted">
            {[row.spendType ? SPEND_TYPE_LABEL[row.spendType] : null, row.expenseDate ? formatDate(row.expenseDate) : null, row.expenseCategoryName].filter(Boolean).join(' · ')}
          </div>
        </div>
      ),
    },
    {
      title: 'Charged to',
      key: 'chargedTo',
      render: (_v, row) => (
        <div>
          <div className="text-ink">{row.projectName ?? 'Company overhead'}</div>
          <div className="text-[11.5px] text-muted">{row.legalEntityName ?? '—'}</div>
        </div>
      ),
    },
    {
      title: 'Paid by',
      key: 'paidBy',
      render: (_v, row) => (
        <div>
          <div className="text-ink">{row.paymentModeLabel ?? '—'}</div>
          <div className="text-[11.5px] text-muted">{row.paymentSourceLabel ?? ''}</div>
        </div>
      ),
    },
    {
      title: 'Amount (₹)',
      key: 'amount',
      align: 'right',
      render: (_v, row) => (
        <div className="whitespace-nowrap tabular-nums">
          <div className="font-semibold text-ink">{formatMoney(row.amount)}</div>
          <div className="text-[11.5px] text-muted">
            {row.gstAmount && Number(row.gstAmount) > 0 ? `${formatMoney(row.taxableAmount)} + GST ${formatMoney(row.gstAmount)}` : 'No GST'}
          </div>
        </div>
      ),
    },
    {
      title: 'Bill link',
      key: 'billUrl',
      render: (_v, row) =>
        row.billUrl ? (
          <a href={row.billUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
            Open
          </a>
        ) : (
          '—'
        ),
    },
    {
      title: 'GST',
      key: 'gstType',
      width: 130,
      render: (_v, row) =>
        row.supplyType ? (
          <Select
            size="small"
            className="w-full"
            value={row.supplyType}
            onChange={(supplyType: 'INTRASTATE' | 'INTERSTATE') => choose(row.rowNumber, { supplyType })}
            options={[
              { value: 'INTERSTATE', label: 'IGST' },
              { value: 'INTRASTATE', label: 'CGST+SGST' },
            ]}
          />
        ) : (
          '—'
        ),
    },
    {
      title: 'Check',
      key: 'errors',
      width: 260,
      render: (_v, row) =>
        row.errors.length ? (
          <ul className="m-0 list-disc pl-4 text-[12px] text-negative">
            {row.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : row.employeeId ? (
          <StatusTag status="OK" label="Ready" tone="pos" />
        ) : (
          <StatusTag status="CHOOSE" label="Choose employee" tone="warn" />
        ),
    },
  ];

  const blocked = !result || result.errorCount > 0 || result.needsChoiceCount > 0 || result.validCount === 0 || !contentBase64;

  return (
    <Modal
      title="Import Servers & Subscriptions (Excel)"
      open={open}
      onCancel={close}
      width={1240}
      okText={result && result.validCount > 0 ? `Post ${result.validCount} bill(s) · ${formatMoney(result.totalAmount)}` : 'Post'}
      okButtonProps={{ disabled: blocked }}
      confirmLoading={importRows.isPending}
      onOk={() => contentBase64 && importRows.mutate({ contentBase64, choices, idempotencyKey: importKey })}
      destroyOnHidden
    >
      <p className="mt-0 text-[12.5px] text-muted">
        One row per bill: employee, subscription name, basic amount, GST amount, total paid, date, project, server or subscription, payment mode, card or
        account number, and legal entity. Amounts are in rupees; a ₹ sign and commas are ignored. Every name is checked against the
        masters. Each row is posted as a direct expense; nothing is posted until every row is clear.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Upload accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" showUploadList={false} beforeUpload={(file) => load(file)}>
          <Button>Choose Excel</Button>
        </Upload>
        <Button type="link" loading={sampleLoading} onClick={() => void downloadSample()}>
          Download sample
        </Button>
        {fileName ? <span className="text-[12.5px] text-muted">{fileName}</span> : null}
      </div>
      {result && result.errorCount > 0 ? (
        <Alert type="error" showIcon className="mb-3" message={`${result.errorCount} row(s) need fixing in the sheet. Fix them and choose the file again; nothing is posted until every row is clear.`} />
      ) : null}
      {result && result.errorCount === 0 && result.needsChoiceCount > 0 ? (
        <Alert type="warning" showIcon className="mb-3" message={`Choose the employee on ${result.needsChoiceCount} row(s): more than one employee has that name.`} />
      ) : null}
      <Table
        rowKey="rowNumber"
        size="small"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        loading={preview.isPending}
        columns={columns}
        dataSource={result?.rows ?? []}
        rowClassName={(row) => (row.errors.length ? 'bg-negative-soft' : '')}
        tableLayout="auto"
        scroll={{ x: true }}
        locale={{ emptyText: 'Choose an Excel file.' }}
      />
    </Modal>
  );
}
