'use client';

import { useEffect } from 'react';
import { Button, Form, Input, Segmented, Select } from 'antd';
import { MasterSelect } from '@/components/master-select';
import { ProductSelect } from '@/components/product-select';
import { BarChartIcon, MoneyInput, StatusTag } from '@zitaware/ui';
import type { StatusTagTone } from '@zitaware/ui';
import { formatMoney } from '@/lib/format';

export type VendorBillStatus = 'DRAFT' | 'SUBMITTED' | 'FINALIZED' | 'REJECTED' | 'CANCELLED' | 'VOID';
export type VendorBillPriority = 'NORMAL' | 'URGENT' | 'LOW';
export type VendorBillDecisionType = 'APPROVED' | 'REJECTED';

export interface VendorBillLineRow {
  id: string;
  sequence: number;
  description: string;
  /** A line is either an expense line or a stock line — never both
   * (Phase 7.2). Both halves are nullable here for that reason. */
  expenseCategoryId: string | null;
  expenseCategoryName: string | null;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  inventoryItemCode: string | null;
  /** Null only for the one legacy row that predates this field. */
  unitOfMeasureId: string | null;
  unitOfMeasureName: string | null;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  itcEligible: boolean;
  lineTotal: string;
}

export interface VendorBillDecisionRow {
  id: string;
  decision: VendorBillDecisionType;
  actorId: string;
  decidedAt: string;
  note: string | null;
  isSelfApproval: boolean;
}

export interface VendorBillRow {
  id: string;
  projectId: string | null;
  projectName: string | null;
  billUrl: string | null;
  paymentReceiptUrl: string | null;
  vendorId: string;
  vendorName: string;
  priority: VendorBillPriority;
  legalEntityId: string;
  legalEntityName: string;
  gstRegistrationId: string;
  gstRegistrationGstin: string;
  vendorBillNumber: string;
  vendorBillDate: string;
  status: VendorBillStatus;
  taxableAmount: string | null;
  cgstAmount: string | null;
  sgstAmount: string | null;
  igstAmount: string | null;
  totalAmount: string | null;
  journalEntryId: string | null;
  voidJournalEntryId: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  createdBy: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  createdAt: string;
  version: number;
}

export interface VendorBillDetailData extends VendorBillRow {
  lines: VendorBillLineRow[];
  /** Newest first. At most one row this slice — REJECTED/CANCELLED are
   * terminal, and a FINALIZED bill is never decided again. */
  decisions: VendorBillDecisionRow[];
}

export interface VendorBillLinePreviewRow {
  sequence: number;
  description: string;
  expenseCategoryId: string | null;
  expenseCategoryName: string | null;
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  unitOfMeasureId: string;
  unitOfMeasureName: string;
  hsnSac: string | null;
  quantity: string;
  unitPrice: string;
  taxableAmount: string;
  gstRatePercent: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  itcEligible: boolean;
  lineTotal: string;
}

export interface VendorBillLinesPreview {
  lines: VendorBillLinePreviewRow[];
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

const STATUS_TONE: Record<VendorBillStatus, StatusTagTone> = {
  DRAFT: 'mut',
  SUBMITTED: 'warn',
  FINALIZED: 'pos',
  REJECTED: 'neg',
  CANCELLED: 'mut',
  VOID: 'neg',
};
const STATUS_TEXT: Record<VendorBillStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  FINALIZED: 'Finalized',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  VOID: 'Void',
};

export function VendorBillStatusTag({ status }: { status: VendorBillStatus }) {
  return <StatusTag status={status} label={STATUS_TEXT[status]} tone={STATUS_TONE[status]} />;
}

export const PRIORITY_OPTIONS: Array<{ value: VendorBillPriority; label: string }> = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'LOW', label: 'Low' },
];

export interface LineItemFormValue {
  description: string;
  /** Set when lineType is EXPENSE. */
  expenseCategoryId?: string;
  /** Set when lineType is STOCK. */
  inventoryItemId?: string;
  /** Local-only: drives which of the two pickers is shown. Never sent —
   * the server infers the line type from which id is present. */
  lineType?: 'EXPENSE' | 'STOCK';
  unitOfMeasureId: string;
  hsnSac?: string;
  quantity: string;
  unitPrice: string;
  gstRatePercent: string;
  /** Local-only convenience field — a two-way mirror of gstRatePercent
   * against this line's own live-preview taxable amount, same mechanic as
   * the Record Payment page's deduction Rate %/Amount pair. Never
   * submitted — only gstRatePercent is sent to the server, and the DB
   * only ever stores computed amounts, exactly as before. */
  gstAmountEntry?: string;
  itcEligible: boolean;
}

function VendorBillLineRowEditor({
  field,
  canRemove,
  remove,
}: {
  field: { name: number };
  canRemove: boolean;
  remove: (index: number) => void;
}) {
  const form = Form.useFormInstance<{ lines: LineItemFormValue[] }>();

  // The GST rate/amount base is this row's own quantity × unit price —
  // read live so both directions sync instantly. Deliberately NOT sourced
  // from the debounced server preview: a line isn't included in that
  // preview until it already has a GST rate (see the two editing pages'
  // own validLines filter), which would make the very first rate/amount
  // entry a no-op — a real bug, not a hypothetical one. Taxable = qty ×
  // price is plain arithmetic the user already directly controls via
  // those two fields, not a GST/business-rule computation — the
  // authoritative taxable/CGST/SGST/IGST/total figures the user actually
  // sees (Live Summary panel, and everything persisted) still only ever
  // come from the server's own computeLines(), unchanged.
  const lineType = (Form.useWatch(['lines', field.name, 'lineType'], form) ?? 'EXPENSE') as 'EXPENSE' | 'STOCK';
  const quantity = Form.useWatch(['lines', field.name, 'quantity'], form);
  const unitPrice = Form.useWatch(['lines', field.name, 'unitPrice'], form);
  const gstRatePercent = Form.useWatch(['lines', field.name, 'gstRatePercent'], form);
  const baseAmount = (() => {
    const q = Number(quantity);
    const p = Number(unitPrice);
    return quantity && unitPrice && !Number.isNaN(q) && !Number.isNaN(p) ? q * p : undefined;
  })();

  // Quantity/unit price change → the base changes → re-derive the amount
  // from whatever rate is already there (never the other way around: rate
  // is the more fixed input, e.g. a known GST slab, amount is the
  // convenience one). Only recomputes if a rate is already present —
  // otherwise there's nothing to re-derive from yet.
  useEffect(() => {
    if (!baseAmount) return;
    const rate = Number(gstRatePercent);
    if (!gstRatePercent || Number.isNaN(rate)) return;
    form.setFieldValue(['lines', field.name, 'gstAmountEntry'], ((baseAmount * rate * 2) / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-derive when the base (qty×price) itself changes, not on every gstRatePercent keystroke (that's already handled by applyRate below)
  }, [baseAmount]);

  const applyRate = (rateInput: string) => {
    if (!baseAmount) return;
    const rate = Number(rateInput);
    if (!rateInput || Number.isNaN(rate)) return;
    form.setFieldValue(['lines', field.name, 'gstAmountEntry'], ((baseAmount * rate * 2) / 100).toFixed(2));
  };

  const applyAmount = (amountInput: string) => {
    if (!baseAmount) return;
    const amount = Number(amountInput);
    if (!amountInput || Number.isNaN(amount)) return;
    form.setFieldValue(['lines', field.name, 'gstRatePercent'], ((amount / baseAmount) * 50).toFixed(2));
  };

  return (
    <div className="rounded-ui border border-ui p-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Form.Item
          {...field}
          label="Description"
          name={[field.name, 'description']}
          rules={[{ required: true, message: 'Description is required.' }]}
          className="md:col-span-3"
>
          <Input placeholder="e.g. Dell PowerEdge server, 2U rack" />
        </Form.Item>
        <Form.Item
          {...field}
          label="Line type"
          name={[field.name, 'lineType']}
          initialValue="EXPENSE"
          tooltip="A stock line adds the item to Inventory and debits the Inventory account. An expense line is written off to its category immediately."
>
          <Select
            options={[
              { value: 'EXPENSE', label: 'Expense' },
              { value: 'STOCK', label: 'Stock item' },
            ]}
            onChange={() => {
              // The two targets are mutually exclusive server-side, so
              // clear the other one rather than sending both.
              form.setFieldValue(['lines', field.name, 'expenseCategoryId'], undefined);
              form.setFieldValue(['lines', field.name, 'inventoryItemId'], undefined);
            }}
          />
        </Form.Item>
        {lineType === 'STOCK' ? (
          <Form.Item {...field} label="Stock item" name={[field.name, 'inventoryItemId']} rules={[{ required: true, message: 'Item is required.' }]}>
            <ProductSelect stockTrackedOnly />
          </Form.Item>
        ) : (
          <Form.Item {...field} label="Expense category" name={[field.name, 'expenseCategoryId']} rules={[{ required: true, message: 'Category is required.' }]}>
            <MasterSelect type="expense_categories" placeholder="Select category…" />
          </Form.Item>
        )}
        <Form.Item {...field} label="Unit" name={[field.name, 'unitOfMeasureId']} rules={[{ required: true, message: 'Unit is required.' }]}>
          <MasterSelect type="units_of_measure" placeholder="Select unit…" />
        </Form.Item>
        <Form.Item {...field} label="HSN / SAC" name={[field.name, 'hsnSac']}>
          <Input placeholder="e.g. 8471" />
        </Form.Item>
        <Form.Item
          {...field}
          label="Quantity"
          name={[field.name, 'quantity']}
          initialValue="1"
          rules={[{ required: true, message: 'Quantity is required.' }]}
>
          <Input placeholder="1" />
        </Form.Item>
        <Form.Item
          {...field}
          label="Unit price (₹)"
          name={[field.name, 'unitPrice']}
          rules={[{ required: true, message: 'Unit price is required.' }]}
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
          <Input placeholder="9" onChange={(e) => applyRate(e.target.value)} />
        </Form.Item>
        <Form.Item {...field} label="GST amount (₹)" name={[field.name, 'gstAmountEntry']} extra="Enter either the rate or the amount — they stay in sync.">
          <MoneyInput placeholder="0.00" onChange={(value) => applyAmount(value ?? '')} />
        </Form.Item>
        <Form.Item {...field} label="ITC eligible?" name={[field.name, 'itcEligible']} initialValue={true}>
          <Segmented
            options={[
              { label: 'Yes', value: true },
              { label: 'No', value: false },
            ]}
          />
        </Form.Item>
      </div>
      {canRemove ? (
        <Button size="small" danger onClick={() => remove(field.name)}>
          Remove Line
        </Button>
      ) : null}
    </div>
  );
}

/** Line-item editor for both the draft-create and draft-edit forms.
 * Deliberately shows no server-authoritative CGST/SGST/IGST split per row
 * (that only ever comes from the Live Summary panel, fed by
 * calculatePreview) — CLAUDE.md: "Do not calculate accounting totals
 * independently in React components." Each row's own GST rate/amount
 * two-way entry uses only its own quantity × unit price as a base (see
 * `VendorBillLineRowEditor`'s own comment for why that's not the same
 * thing). Each line carries its own ITC-eligible toggle (docs/06:
 * "ineligible GST is included in cost rather than Input GST Receivable"
 * — a per-item decision, not a whole-bill one). */
export function VendorBillLineItemsEditor({
  defaultUnitOfMeasureId,
}: {
  defaultUnitOfMeasureId: string | undefined;
}) {
  const form = Form.useFormInstance<{ lines: LineItemFormValue[] }>();

  return (
    <Form.List name="lines" rules={[{ validator: async (_, lines) => (lines && lines.length > 0 ? Promise.resolve() : Promise.reject(new Error('At least one line item is required.'))) }]}>
      {(fields, { add, remove }, { errors }) => (
        <div className="flex flex-col gap-3">
          {fields.map(({ key, ...field }) => (
            <VendorBillLineRowEditor key={key} field={field} canRemove={fields.length > 1} remove={remove} />
          ))}
          <Form.ErrorList errors={errors} />
          <Button
            onClick={() => {
              // A new line starts with the previous line's own expense
              // category, GST rate, and ITC eligibility (usually all the
              // same for a run of similar items on one bill) — quantity
              // and unit stay a fresh per-line default, since those are
              // far less likely to repeat.
              const lines = form.getFieldValue('lines') as LineItemFormValue[] | undefined;
              const previous = lines?.[lines.length - 1];
              add({
                itcEligible: previous?.itcEligible ?? true,
                quantity: '1',
                unitOfMeasureId: defaultUnitOfMeasureId,
                expenseCategoryId: previous?.expenseCategoryId,
                gstRatePercent: previous?.gstRatePercent,
              });
            }}
          >
            Add Line
          </Button>
        </div>
      )}
    </Form.List>
  );
}

/** Sticky right-side summary panel — same mechanism and layout as the
 * Record Payment page's own "Live Calculation" panel: a debounced server
 * call (see the two editing pages) fills `preview`, and this component
 * only ever renders what it was last given. Nothing is computed here. */
export function VendorBillLivePreviewPanel({
  preview,
  loading,
  error,
}: {
  preview: VendorBillLinesPreview | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="bg-paper p-4 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-center gap-[7px] text-[11px] font-bold uppercase tracking-[.05em] text-brand">
        <BarChartIcon className="h-[14px] w-[14px]" />
        Live Summary
      </div>

      {!preview || preview.lines.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted">{loading ? 'Calculating…' : 'Add a line item — this updates automatically.'}</p>
      ) : (
        <>
          {preview.lines.map((line, index) => (
            <div key={index} className="border-b border-ui-2 py-2 text-[13px]">
              <div className="flex justify-between gap-2 text-muted">
                <span className="truncate">{line.description || `Line ${index + 1}`}</span>
                <span className="shrink-0 font-mono font-semibold text-ink">{formatMoney(line.lineTotal)}</span>
              </div>
              <div className="text-[11px] text-muted-2">
                Taxable {formatMoney(line.taxableAmount)} · GST {formatMoney((Number(line.cgstAmount) + Number(line.sgstAmount) + Number(line.igstAmount)).toFixed(2))}
              </div>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-b border-ui-2 py-2 text-[13px]">
            <span className="text-muted">Taxable</span>
            <span className="font-mono font-semibold text-ink">{formatMoney(preview.taxableAmount)}</span>
          </div>
          {Number(preview.cgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 py-2 text-[13px]">
              <span className="text-muted">CGST</span>
              <span className="font-mono font-semibold text-ink">{formatMoney(preview.cgstAmount)}</span>
            </div>
          ) : null}
          {Number(preview.sgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 py-2 text-[13px]">
              <span className="text-muted">SGST</span>
              <span className="font-mono font-semibold text-ink">{formatMoney(preview.sgstAmount)}</span>
            </div>
          ) : null}
          {Number(preview.igstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 py-2 text-[13px]">
              <span className="text-muted">IGST</span>
              <span className="font-mono font-semibold text-ink">{formatMoney(preview.igstAmount)}</span>
            </div>
          ) : null}
          <div className="mt-2 flex justify-between rounded-ui bg-ink px-3 py-[11px] text-white">
            <span className="font-semibold">Total</span>
            <span className="font-mono text-[15px] font-semibold">{formatMoney(preview.totalAmount)}</span>
          </div>
        </>
      )}
      {error ? <p className="mt-2 text-[12px] text-negative">{error}</p> : null}
      <p className="mt-3 text-[11px] leading-[1.5] text-muted">
        Every figure here is computed by the server from what you&apos;ve entered — nothing is calculated in the browser.
      </p>
    </div>
  );
}
