'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Form, Input, Button, Modal, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MoneyInput, StatusTag } from '@zitaware/ui';
import type { InvoiceCollection, InvoiceReceiptAllocation } from '@zitaware/contracts';
import type { StatusTagTone } from '@zitaware/ui';
import { fromBase64 } from '@/lib/document-crypto';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';

/** Mirrors INVOICE_INWARD_COPY_LINK_TYPE in @zitaware/contracts (ports/invoice.port.ts)
 * — duplicated here rather than imported, since @zitaware/contracts's index.ts
 * also re-exports the server-only tRPC init (./trpc), and any runtime
 * (non `import type`) import from that package pulls the whole module graph
 * into the client bundle, breaking `@trpc/server` in the browser. Every other
 * apps/web import from @zitaware/contracts is `import type` for this reason. */
export const INVOICE_INWARD_COPY_LINK_TYPE = 'INWARD_COPY';

export interface InvoiceRow {
  id: string;
  projectId: string;
  projectName: string;
  legalEntityId: string;
  legalEntityName: string;
  gstRegistrationId: string;
  gstRegistrationGstin: string;
  paymentAlertId: string;
  milestoneType: 'CAPEX' | 'OPEX';
  sourceEventId: string | null;
  sourceInstallmentId: string | null;
  sourceTitle: string;
  status: 'DRAFT' | 'ISSUED' | 'FINALIZED' | 'VOID' | 'CONVERTED';
  kind: 'REGULAR' | 'PROFORMA';
  invoiceNumber: string | null;
  proformaNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  paymentTermsDays: number | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  taxableAmount: string | null;
  cgstAmount: string | null;
  sgstAmount: string | null;
  igstAmount: string | null;
  totalAmount: string | null;
  outstandingAmount: string | null;
  /** Billed and collected, from the API (ADR-155). Null unless FINALIZED. */
  collection: InvoiceCollection | null;
  hasInwardCopy: boolean;
  narrative: string | null;
  journalEntryId: string | null;
  voidJournalEntryId: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  version: number;
}

export interface InvoiceLineRow {
  id: string;
  sequence: number;
  description: string;
  hsnSac: string | null;
  sourceEventId: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

export interface InvoiceDetailData extends InvoiceRow {
  overBilledBy: string | null;
  underBilledBy: string | null;
  completesSource: boolean;
  sellerLegalName: string | null;
  sellerPan: string | null;
  sellerGstin: string | null;
  sellerState: string | null;
  sellerAddress: string | null;
  buyerName: string | null;
  buyerGstin: string | null;
  buyerState: string | null;
  buyerAddress: string | null;
  lines: InvoiceLineRow[];
  receipts: InvoiceReceiptAllocation[];
  convertedFromInvoiceId: string | null;
  convertedFromProformaNumber: string | null;
  convertedToInvoiceId: string | null;
  convertedToInvoiceNumber: string | null;
  convertedToStatus: InvoiceRow['status'] | null;
  previousOpexLabel: string | null;
  previousOpexLines: Array<{ description: string; hsnSac: string | null; unitPrice: string; gstRatePercent: string }> | null;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

const STATUS_TONE: Record<InvoiceRow['status'], StatusTagTone> = {
  DRAFT: 'info',
  ISSUED: 'warn',
  FINALIZED: 'pos',
  VOID: 'neg',
  CONVERTED: 'warn',
};
const STATUS_TEXT: Record<InvoiceRow['status'], string> = {
  DRAFT: 'Draft',
  ISSUED: 'Proforma issued',
  FINALIZED: 'Tax invoice',
  VOID: 'Void',
  CONVERTED: 'Proforma kept',
};

function isZero(value: string): boolean {
  return /^-?0+(\.0+)?$/.test(value.trim());
}

/** A settlement figure; zero reads as a dash so the columns that matter stand out. */
export function SettlementMoney({ value }: { value: string | null | undefined }) {
  if (value == null || isZero(value)) return <span className="text-muted-2">—</span>;
  return <>{formatMoney(value)}</>;
}

export function OutstandingMoney({ value }: { value: string | null | undefined }) {
  if (value == null) return <span className="text-muted-2">—</span>;
  if (isZero(value)) return <span className="text-positive">Settled</span>;
  if (value.trim().startsWith('-')) return <span className="text-information">{formatMoney(value)} credit</span>;
  return <span className="font-medium text-negative">{formatMoney(value)}</span>;
}

const DEDUCTION_LINES: Array<[keyof InvoiceCollection, string]> = [
  ['tds', 'TDS'],
  ['gstTds', 'GST-TDS'],
  ['hold', 'Hold'],
  ['retention', 'Retention'],
  ['released', 'Released'],
  ['penalty', 'Penalty'],
  ['otherDeductions', 'Other'],
];

/**
 * Cash received, then each deduction that applies on its own line (TDS,
 * GST-TDS, hold, retention, released, penalty, other) — docs/04 §11.5's
 * figures kept apart, stacked in one cell so the table fits without
 * scrolling sideways. Every figure is the API's collection (ADR-155).
 */
export function CollectionCell({ collection }: { collection: InvoiceCollection | null | undefined }) {
  if (!collection) return <span className="text-muted-2">—</span>;
  const lines = DEDUCTION_LINES.filter(([key]) => !isZero(collection[key]));
  return (
    <div>
      <div>
        <SettlementMoney value={collection.received} />
      </div>
      {lines.map(([key, label]) => (
        <div key={key} className="whitespace-nowrap text-[11.5px] text-muted">
          {label} {formatMoney(collection[key])}
        </div>
      ))}
    </div>
  );
}

/** Received with its deductions, and true outstanding (docs/04 §11.5, ADR-155). */
export function collectionColumns<T>(collectionOf: (row: T) => InvoiceCollection | null): ColumnsType<T> {
  return [
    {
      title: 'Received & Deductions',
      key: 'received',
      align: 'right',
      render: (_v, row) => <CollectionCell collection={collectionOf(row)} />,
    },
    {
      title: 'Outstanding',
      key: 'outstanding',
      align: 'right',
      render: (_v, row) => <OutstandingMoney value={collectionOf(row)?.outstanding} />,
    },
  ];
}

/** "For 01/08/2026 – 31/08/2026": the service period an invoice bills; null when it has none (a CAPEX event). */
export function servicePeriodLabel(row: { servicePeriodStart: string | null; servicePeriodEnd: string | null }): string | null {
  return row.servicePeriodStart && row.servicePeriodEnd ? `For ${formatDate(row.servicePeriodStart)} – ${formatDate(row.servicePeriodEnd)}` : null;
}

/** A dropdown option on two lines, so a long title is read in full instead of cut off. */
export function TwoLineOption({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="whitespace-normal py-0.5 leading-snug">
      <div className="text-ink">{title}</div>
      <div className="text-[12px] text-muted">{detail}</div>
    </div>
  );
}

export function invoiceListNumber(row: Pick<InvoiceRow, 'invoiceNumber' | 'proformaNumber'>): string | null {
  return row.invoiceNumber ?? row.proformaNumber;
}

export function InvoiceStatusTag({ status }: { status: InvoiceRow['status'] }) {
  return <StatusTag status={status} label={STATUS_TEXT[status]} tone={STATUS_TONE[status]} />;
}

/** Downloads a base64-encoded file returned by invoices.getPdf — same
 * fromBase64 + Blob + object-URL approach as documents-tab.tsx's own
 * download path, without the encryption layer (invoice PDFs aren't
 * client-uploaded documents). */
export function downloadBase64Pdf(filename: string, base64: string) {
  const bytes = fromBase64(base64);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface LineItemFormValue {
  description: string;
  hsnSac?: string;
  sourceEventId?: string;
  unitPrice: string;
  gstRatePercent: string;
}

export function CopyPreviousOpexLines({
  label,
  lines,
  onCopy,
}: {
  label: string | null;
  lines: Array<{ description: string; hsnSac: string | null; unitPrice: string; gstRatePercent: string }> | null;
  onCopy: (lines: LineItemFormValue[]) => void;
}) {
  if (!label || !lines || lines.length === 0) return null;
  return (
    <div className="mb-3">
      <Button
        onClick={() =>
          onCopy(
            lines.map((line) => ({
              description: line.description,
              ...(line.hsnSac ? { hsnSac: line.hsnSac } : {}),
              unitPrice: line.unitPrice,
              gstRatePercent: line.gstRatePercent,
            })),
          )
        }
      >
        Copy line items from previous
      </Button>
      <p className="mt-1 text-[12.5px] text-muted">Replaces the lines below with the lines from {label}.</p>
    </div>
  );
}

/** Line-item editor used by both the draft-create and draft-edit forms.
 * Deliberately shows no computed taxable/tax/total figures — CLAUDE.md:
 * "Do not calculate accounting totals independently in React components."
 * Authoritative amounts only ever come back from the server, on the
 * resulting invoice after submit. */
export function LineItemsEditor() {
  return (
    <Form.List name="lines" rules={[{ validator: async (_, lines) => (lines && lines.length > 0 ? Promise.resolve() : Promise.reject(new Error('At least one line item is required.'))) }]}>
      {(fields, { add, remove }, { errors }) => (
        <div className="flex flex-col gap-3">
          {fields.map(({ key, ...field }) => (
            <div key={key} className="rounded-ui border border-ui p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Form.Item
                  {...field}
                  label="Description"
                  name={[field.name, 'description']}
                  rules={[{ required: true, message: 'Description is required.' }]}
                  className="md:col-span-3"
>
                  <Input placeholder="e.g. M3 — DEOC Integration, 2 districts" />
                </Form.Item>
                <Form.Item {...field} name={[field.name, 'sourceEventId']} hidden>
                  <Input />
                </Form.Item>
                <Form.Item {...field} label="HSN / SAC" name={[field.name, 'hsnSac']}>
                  <Input placeholder="e.g. 998314" />
                </Form.Item>
                <Form.Item
                  {...field}
                  label="Amount (₹)"
                  name={[field.name, 'unitPrice']}
                  rules={[{ required: true, message: 'Amount is required.' }]}
>
                  <MoneyInput placeholder="0.00" />
                </Form.Item>
                <Form.Item
                  {...field}
                  label="GST rate (%)"
                  name={[field.name, 'gstRatePercent']}
                  rules={[{ required: true, message: 'GST rate is required.' }]}
                  extra="Same state: this percent is CGST and this percent is SGST. A different state charges twice this percent as IGST."
>
                  <Input placeholder="9" />
                </Form.Item>
              </div>
              {fields.length > 1 ? (
                <Button size="small" danger onClick={() => remove(field.name)}>
                  Remove Line
                </Button>
              ) : null}
            </div>
          ))}
          <Form.ErrorList errors={errors} />
          <Button onClick={() => add()}>Add Line</Button>
        </div>
      )}
    </Form.List>
  );
}

export function gstRegistrationSelectOptions(
  options: Array<{ id: string; gstin: string; tradeName: string | null }>,
): Array<{ value: string; label: string }> {
  return options.map((o) => ({ value: o.id, label: `${o.gstin}${o.tradeName ? ` — ${o.tradeName}` : ''}` }));
}

/**
 * Entry point for "Add Invoice" — used both globally (from the /invoices
 * list, where there's no project in context) and from a project's own
 * Invoices tab (where defaultProjectId skips the project step). Every
 * invoice still must originate from a payment alert (docs/04: ad-hoc
 * invoice creation removed) — this just adds a project-then-alert picker
 * in front of the existing /projects/[id]/invoices/new?paymentAlertId=...
 * route, rather than inventing a second creation path.
 */
export function RaiseInvoiceModal({
  open,
  onClose,
  defaultProjectId,
}: {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const projects = trpc.projects.list.useQuery(undefined, { enabled: open && !defaultProjectId });
  const [projectId, setProjectId] = useState<string | undefined>(defaultProjectId);
  const [alertId, setAlertId] = useState<string | undefined>(undefined);

  const overview = trpc.paymentAlerts.listForProject.useQuery({ projectId: projectId ?? '' }, { enabled: !!projectId });
  // Earliest due first; open and snoozed together.
  const alerts = [...(overview.data?.openAlerts ?? []), ...(overview.data?.snoozedAlerts ?? [])].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, undefined, { numeric: true }),
  );
  const alertOptions = alerts.map((a) => ({
    value: a.id,
    label: `${a.title} — ${formatMoney(a.amount)} — due ${formatDate(a.dueDate)}`,
    title: a.title,
    detail: [
      a.servicePeriodStart && a.servicePeriodEnd ? `Period ${formatDate(a.servicePeriodStart)} – ${formatDate(a.servicePeriodEnd)}` : null,
      formatMoney(a.amount),
      `due ${formatDate(a.dueDate)}`,
      a.status === 'SNOOZED' ? 'snoozed' : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }));

  const reset = () => {
    setProjectId(defaultProjectId);
    setAlertId(undefined);
  };

  return (
    <Modal
      title="Raise Invoice"
      open={open}
      afterOpenChange={(isOpen) => (isOpen ? reset() : undefined)}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={() => {
        if (!projectId || !alertId) return;
        reset();
        onClose();
        router.push(`/projects/${projectId}/invoices/new?paymentAlertId=${alertId}`);
      }}
      okButtonProps={{ disabled: !projectId || !alertId }}
      okText="Continue"
    >
      <div className="flex flex-col gap-3">
        {defaultProjectId ? null : (
          <label className="flex flex-col gap-[3px]">
            <span className="text-[12.5px] font-semibold text-text">Project</span>
            <Select
              placeholder="Select project…"
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setAlertId(undefined);
              }}
              loading={projects.isLoading}
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </label>
        )}
        <label className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] font-semibold text-text">Payment alert</span>
          <Select
            placeholder={projectId ? 'Select alert…' : 'Select a project first'}
            value={alertId}
            onChange={setAlertId}
            disabled={!projectId}
            loading={overview.isLoading}
            options={alertOptions}
            optionRender={(o) => <TwoLineOption title={o.data.title} detail={o.data.detail} />}
            notFoundContent={projectId && !overview.isLoading ? 'No open or snoozed alerts for this project.' : undefined}
          />
        </label>
      </div>
    </Modal>
  );
}
