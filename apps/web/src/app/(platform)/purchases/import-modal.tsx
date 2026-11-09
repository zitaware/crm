'use client';

import { useState } from 'react';
import { Alert, App, Button, Modal, Select, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { StatusTag } from '@zitaware/ui';
import type { PurchaseImportChoice, PurchaseImportRow } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { downloadWorkbook } from '../employees/import-modal';
import { newIdempotencyKey } from '../vendor-bills/shared';

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The purchase register from Excel (ADR-178): every row checked first, a
 * supplier not found is added, each row posts as an approved bill and is paid
 * from the card or account given. Every figure and error comes from the API.
 */
export function ImportPurchasesModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => Promise<void> }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);
  const [sampleLoading, setSampleLoading] = useState(false);
  // The per-row GST switch (ADR-179): each change re-checks the sheet, so totals stay the API's.
  const [choices, setChoices] = useState<PurchaseImportChoice[]>([]);
  const preview = trpc.purchases.previewImport.useMutation({ onError: (e) => message.error(e.message) });
  const chooseSplit = (rowNumber: number, gstSplit: 'CGST_SGST' | 'IGST') => {
    const next = [...choices.filter((c) => c.rowNumber !== rowNumber), { rowNumber, gstSplit }];
    setChoices(next);
    if (content) preview.mutate({ contentBase64: content, choices: next });
  };
  const reset = () => {
    setChoices([]);
    setContent(null);
    setFileName(null);
    setKey(newIdempotencyKey());
    preview.reset();
  };
  const importRows = trpc.purchases.importRows.useMutation({
    onSuccess: async (r) => {
      message.success(
        `${r.bills} bill(s) imported and paid${r.vendorsCreated ? `, ${r.vendorsCreated} new vendor(s) added` : ''}${r.categoriesCreated ? `, ${r.categoriesCreated} new categor${r.categoriesCreated === 1 ? 'y' : 'ies'} added` : ''}.`,
      );
      reset();
      await onImported();
      onClose();
    },
    onError: (e) => message.error(e.message),
  });

  const result = preview.data;
  const columns: ColumnsType<PurchaseImportRow> = [
    { title: 'Row', dataIndex: 'rowNumber', key: 'row', width: 56 },
    {
      title: 'Supplier',
      key: 'supplier',
      render: (_v, r) => (
        <div>
          <div className="text-ink">
            {r.supplier} {r.vendorIsNew ? <Tag color="gold">New vendor</Tag> : null}
          </div>
          <div className="text-[11.5px] text-muted">{[r.date ? formatDate(r.date) : null, r.legalEntityName].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    {
      title: 'Details',
      key: 'details',
      render: (_v, r) => (
        <div className="max-w-[320px]">
          <div className="line-clamp-2 whitespace-pre-line text-ink">{r.details}</div>
          <div className="text-[11.5px] text-muted">
            {[r.projectName ?? 'Company overhead', r.categoryName].filter(Boolean).join(' · ')} {r.categoryIsNew ? <Tag color="gold">New category</Tag> : null}
          </div>
        </div>
      ),
    },
    {
      title: 'Amount',
      key: 'amount',
      align: 'right',
      render: (_v, r) => (
        <div className="whitespace-nowrap tabular-nums">
          <div className="font-semibold text-ink">{formatMoney(r.totalAmount)}</div>
          <div className="text-[11.5px] text-muted">{r.gstAmount && Number(r.gstAmount) > 0 ? `${formatMoney(r.taxableAmount)} + GST ${formatMoney(r.gstAmount)}` : 'No GST'}</div>
        </div>
      ),
    },
    {
      title: 'GST',
      key: 'gstSplit',
      width: 130,
      render: (_v, r) =>
        r.gstSplit ? (
          <Select
            size="small"
            className="w-full"
            value={r.gstSplit}
            onChange={(v: 'CGST_SGST' | 'IGST') => chooseSplit(r.rowNumber, v)}
            options={[
              { value: 'CGST_SGST', label: 'CGST+SGST' },
              { value: 'IGST', label: 'IGST' },
            ]}
          />
        ) : (
          '—'
        ),
    },
    {
      title: 'Paid by',
      key: 'paid',
      render: (_v, r) => (
        <div>
          <div className="text-ink">{r.paymentModeLabel ?? '—'}</div>
          <div className="text-[11.5px] text-muted">{r.paymentSourceLabel ?? ''}</div>
        </div>
      ),
    },
    {
      title: 'Invoice',
      key: 'invoice',
      render: (_v, r) =>
        r.invoiceLink && /^https?:\/\//i.test(r.invoiceLink) ? (
          <a href={r.invoiceLink} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
            Open
          </a>
        ) : (
          <span className="text-[12px] text-muted">{r.invoiceLink ?? '—'}</span>
        ),
    },
    {
      title: 'Check',
      key: 'errors',
      width: 260,
      render: (_v, r) =>
        r.errors.length ? (
          <ul className="m-0 list-disc pl-4 text-[12px] text-negative">
            {r.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <StatusTag status="OK" label="Ready" tone="pos" />
        ),
    },
  ];

  return (
    <Modal
      title="Import purchase register (Excel)"
      open={open}
      onCancel={() => {
        reset();
        onClose();
      }}
      width={1240}
      okText={result && result.billCount > 0 ? `Import ${result.billCount} bill(s) · ${formatMoney(result.totalAmount)}` : 'Import'}
      okButtonProps={{ disabled: !result || result.errorCount > 0 || result.billCount === 0 || !content }}
      confirmLoading={importRows.isPending}
      onOk={() => content && importRows.mutate({ contentBase64: content, choices, idempotencyKey: key })}
      destroyOnHidden
    >
      <p className="mt-0 text-[12.5px] text-muted">
        Your purchase register as it is: Date, Details, Supplier, Company, Invoice Link, Category, Other Charges, Amount, Amount With GST, Project, Paid by,
        Payment Receipt, plus Payment Mode and Card/Account no. Each row becomes an approved bill, paid on its date from that card or account. A supplier not in
        Vendors, or a category not in Masters, is added. Names are matched ignoring case and spaces; spaces inside a card or account number are ignored.
        Nothing is imported until every row is clear.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Upload
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          showUploadList={false}
          beforeUpload={async (file) => {
            const encoded = await fileToBase64(file);
            setContent(encoded);
            setFileName(file.name);
            setKey(newIdempotencyKey());
            setChoices([]);
            preview.mutate({ contentBase64: encoded, choices: [] });
            return false;
          }}
        >
          <Button>Choose Excel</Button>
        </Upload>
        <Button
          type="link"
          loading={sampleLoading}
          onClick={async () => {
            setSampleLoading(true);
            try {
              const file = await utils.purchases.importSample.fetch();
              downloadWorkbook(file.contentBase64, file.filename);
            } catch (e) {
              message.error(e instanceof Error ? e.message : 'Could not download the sample.');
            } finally {
              setSampleLoading(false);
            }
          }}
        >
          Download sample
        </Button>
        {fileName ? <span className="text-[12.5px] text-muted">{fileName}</span> : null}
      </div>
      {result ? (
        <Alert
          className="mb-3"
          showIcon
          type={result.errorCount > 0 ? 'error' : 'success'}
          message={
            result.errorCount > 0
              ? `${result.errorCount} row(s) need fixing in the sheet; nothing is imported until every row is clear.`
              : `${result.billCount} bill(s), ${formatMoney(result.totalAmount)} paid${result.newVendorCount ? ` · ${result.newVendorCount} new vendor(s)` : ''}${result.newCategoryCount ? ` · ${result.newCategoryCount} new categor${result.newCategoryCount === 1 ? 'y' : 'ies'}` : ''}.`
          }
        />
      ) : null}
      <Table
        rowKey="rowNumber"
        size="small"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        loading={preview.isPending}
        columns={columns}
        dataSource={result?.rows ?? []}
        rowClassName={(r) => (r.errors.length ? 'bg-negative-soft' : '')}
        tableLayout="auto"
        scroll={{ x: true }}
        locale={{ emptyText: 'Choose an Excel file.' }}
      />
    </Modal>
  );
}
