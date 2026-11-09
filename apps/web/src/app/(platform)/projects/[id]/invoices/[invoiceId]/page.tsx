'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Form, Input, Modal, Popconfirm, Radio, Select } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { DocumentsTab } from '@/components/documents-tab';
import {
  downloadBase64Pdf,
  gstRegistrationSelectOptions,
  INVOICE_INWARD_COPY_LINK_TYPE,
  InvoiceStatusTag,
  LineItemsEditor,
  CopyPreviousOpexLines,
  newIdempotencyKey,
  OutstandingMoney,
  SettlementMoney,
  type InvoiceDetailData,
  type LineItemFormValue,
} from '../../../../invoices/shared';
import { DEDUCTION_TYPE_LABEL, ReceiptStatusTag, ReleaseModal, type ReleaseDeductionTarget } from '../../../../payment-integration/shared';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { CreditDebitNoteStatusTag, CreditDebitNoteTypeTag, type CreditDebitNoteRow } from '../../../../credit-debit-notes/shared';
import { DateInput } from '@/components/date-input';

interface DraftFormValues {
  kind: 'REGULAR' | 'PROFORMA';
  gstRegistrationId: string;
  dueDate: string;
  paymentTermsDays?: string;
  narrative?: string;
  lines: LineItemFormValue[];
}

function DraftEditor({ invoice }: { invoice: InvoiceDetailData }) {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canUpdate = permissions.includes('invoice.update');
  const canFinalize = permissions.includes('invoice.finalize');
  const canVoidDraft = permissions.includes('invoice.void');
  const [form] = Form.useForm<DraftFormValues>();
  const formDraft = useFormDraft(`invoice:${invoice.id}`);
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef(false);
  useEffect(() => {
    if (appliedDraft.current || formDraft.isLoading || !formDraft.payload) return;
    appliedDraft.current = true;
    form.setFieldsValue(formDraft.payload as Partial<DraftFormValues>);
  }, [form, formDraft.isLoading, formDraft.payload]);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState('');
  const [manualInvoiceNumber, setManualInvoiceNumber] = useState('');
  // Asked only when the draft bills less than is left on its source (ADR-167).
  const [completesSource, setCompletesSource] = useState<boolean | null>(null);
  const [finalizeKey, setFinalizeKey] = useState(newIdempotencyKey());
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidKey, setVoidKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.invoices.getDetail.invalidate({ id: invoice.id });

  const updateMutation = trpc.invoices.updateDraft.useMutation({
    onSuccess: async () => {
      message.success('Invoice saved.');
      clearDraft.mutate({ formKey: `invoice:${invoice.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const finalizeMutation = trpc.invoices.finalize.useMutation({
    onSuccess: async () => {
      message.success(isProforma ? 'Proforma issued. Nothing was posted to the accounts.' : 'Invoice finalized.');
      setFinalizeOpen(false);
      setFinalizeKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const voidMutation = trpc.invoices.void.useMutation({
    onSuccess: async () => {
      message.success('Draft voided.');
      setVoidOpen(false);
      setVoidKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const kind = Form.useWatch('kind', form) ?? invoice.kind;
  const fromProforma = invoice.convertedFromInvoiceId != null;
  const isProforma = !fromProforma && kind === 'PROFORMA';
  const reusableNumbers = trpc.invoices.reusableNumbers.useQuery(
    { id: invoice.id, invoiceDate },
    { enabled: finalizeOpen && !isProforma && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) },
  );

  const submitUpdate = (values: DraftFormValues) => {
    updateMutation.mutate({
      id: invoice.id,
      expectedVersion: invoice.version,
      ...(fromProforma ? {} : { kind: values.kind }),
      gstRegistrationId: values.gstRegistrationId,
      dueDate: values.dueDate,
      paymentTermsDays: values.paymentTermsDays ? Number(values.paymentTermsDays) : undefined,
      narrative: values.narrative?.trim() || undefined,
      lines: values.lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac?.trim() || undefined,
        quantity: '1',
        unitPrice: l.unitPrice,
        gstRatePercent: l.gstRatePercent,
        ...(l.sourceEventId ? { sourceEventId: l.sourceEventId } : {}),
      })),
    });
  };

  const gstRegistrationOptions = [{ id: invoice.gstRegistrationId, gstin: invoice.gstRegistrationGstin, tradeName: null }];

  return (
    <>
      {invoice.servicePeriodStart && invoice.servicePeriodEnd ? (
        <p className="mb-3 text-[12.5px] text-muted">
          Service period: {formatDate(invoice.servicePeriodStart)} – {formatDate(invoice.servicePeriodEnd)}
        </p>
      ) : null}

      <UiCard title="Draft Invoice">
        <Form<DraftFormValues>
          form={form}
          layout="vertical"
          onFinish={submitUpdate}
          initialValues={{
            kind: invoice.kind,
            gstRegistrationId: invoice.gstRegistrationId,
            dueDate: invoice.dueDate ?? undefined,
            paymentTermsDays: invoice.paymentTermsDays ? String(invoice.paymentTermsDays) : undefined,
            narrative: invoice.narrative ?? undefined,
            lines: invoice.lines.map((l) => ({
              description: l.description,
              hsnSac: l.hsnSac ?? undefined,
              ...(l.sourceEventId ? { sourceEventId: l.sourceEventId } : {}),
              unitPrice: l.unitPrice,
              gstRatePercent: l.gstRatePercent,
            })),
          }}
        >
          {fromProforma ? (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-ui border border-brand bg-brand-soft px-4 py-3">
              <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
              <p className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">
                From proforma {invoice.convertedFromProformaNumber}. Change the lines if this tax invoice should differ. The proforma stays as it was.
              </p>
              <Button size="small" onClick={() => router.push(`/projects/${invoice.projectId}/invoices/${invoice.convertedFromInvoiceId}`)}>
                View proforma
              </Button>
            </div>
          ) : (
            <>
              <Form.Item label="Invoice type" name="kind">
                <Radio.Group>
                  <Radio value="REGULAR">Regular invoice</Radio>
                  <Radio value="PROFORMA">Proforma invoice</Radio>
                </Radio.Group>
              </Form.Item>
              <p className="mb-3 text-[12.5px] text-muted">A regular invoice posts the receivable and GST. A proforma is the document only, until you convert it. The proforma stays.</p>
            </>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Form.Item
              label="Billing GST registration"
              name="gstRegistrationId"
              rules={[{ required: true, message: 'GST registration is required.' }]}
>
              <Select placeholder="Select GST registration…" options={gstRegistrationSelectOptions(gstRegistrationOptions)} />
            </Form.Item>
            <Form.Item label="Due date" name="dueDate" rules={[{ required: true, message: 'Due date is required.' }]}>
              <DateInput />
            </Form.Item>
            <Form.Item label="Payment terms (days)" name="paymentTermsDays">
              <Input placeholder="e.g. 30" />
            </Form.Item>
          </div>

          <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Line Items</p>
          {invoice.milestoneType === 'OPEX' ? (
            <CopyPreviousOpexLines
              label={invoice.previousOpexLabel}
              lines={invoice.previousOpexLines}
              onCopy={(lines) => form.setFieldValue('lines', lines)}
            />
          ) : null}
          <LineItemsEditor />

          <Form.Item label="Heading on invoice" name="narrative" className="mt-4" extra="Printed in the centre, under the buyer.">
            <Input.TextArea rows={2} />
          </Form.Item>

          <div className="flex gap-2">
            {canUpdate ? (
              <>
                {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
                <Button
                  htmlType="button"
                  loading={formDraft.saving}
                  onClick={() => formDraft.save(form.getFieldsValue(true) as unknown as Record<string, unknown>)}
                >
                  Save as draft
                </Button>
                <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>
                  Save
                </Button>
              </>
            ) : null}
            {canFinalize ? (
              <Button
                onClick={() => {
                  setInvoiceDate(new Date().toISOString().slice(0, 10));
                  setManualInvoiceNumber('');
                  setFinalizeOpen(true);
                }}
              >
                {isProforma ? 'Issue proforma…' : 'Finalize…'}
              </Button>
            ) : null}
            {canVoidDraft ? (
              <Button danger onClick={() => setVoidOpen(true)}>
                Void Draft…
              </Button>
            ) : null}
          </div>
        </Form>
      </UiCard>

      <Modal
        title={isProforma ? 'Issue proforma' : 'Finalize Invoice'}
        open={finalizeOpen}
        onCancel={() => setFinalizeOpen(false)}
        onOk={() =>
          finalizeMutation.mutate({
            id: invoice.id,
            expectedVersion: invoice.version,
            invoiceDate,
            ...(!isProforma && manualInvoiceNumber.trim() ? { invoiceNumber: manualInvoiceNumber.trim() } : {}),
            ...(!isProforma && invoice.underBilledBy ? { completesSource: completesSource === true } : {}),
            idempotencyKey: finalizeKey,
          })
        }
        confirmLoading={finalizeMutation.isPending}
        okButtonProps={{ disabled: !invoiceDate || (!isProforma && !!invoice.underBilledBy && completesSource === null) }}
        okText={isProforma ? 'Issue proforma' : 'Finalize'}
      >
        <p className="mb-2 text-muted">
          {isProforma
            ? 'Issuing gives this proforma a number and freezes it. It does not post a receivable, revenue, or GST. Convert it when the books should move. The proforma stays.'
            : 'Finalizing gives the invoice its number, posts the accounting journal, and closes the source payment alert. This cannot be undone except by voiding with a reversal.'}
        </p>
        {!isProforma && invoice.underBilledBy ? (
          <div className="mb-3 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-ink">
            <p className="mb-2">
              This invoice bills <b>{formatMoney(invoice.underBilledBy)}</b> (before GST) less than is left on its{' '}
              {invoice.milestoneType === 'OPEX' ? 'installment' : 'milestone event'}. Is this the full bill?
            </p>
            <Radio.Group value={completesSource} onChange={(e) => setCompletesSource(e.target.value as boolean)} className="flex flex-col gap-1">
              <Radio value={true}>Yes, this is the full bill. Close the alert.</Radio>
              <Radio value={false}>No, more will be billed later. Keep the alert open.</Radio>
            </Radio.Group>
          </div>
        ) : null}
        {invoice.overBilledBy ? (
          <div className="mb-3 rounded-ui border border-ui bg-warning-soft p-3 text-[12.5px] text-ink">
            This invoice bills <b>{formatMoney(invoice.overBilledBy)}</b> (before GST) more than is left on its {invoice.milestoneType === 'OPEX' ? 'installment' : 'milestone event'}. You can still finalize it.
          </div>
        ) : null}
        <p className="mb-2 text-muted">Invoice date</p>
        <DateInput value={invoiceDate} onChange={setInvoiceDate} />
        {!isProforma ? (
          <>
            <p className="mb-2 mt-4 text-muted">Invoice number</p>
            <Input
              value={manualInvoiceNumber}
              onChange={(e) => setManualInvoiceNumber(e.target.value)}
              maxLength={16}
              placeholder="Leave blank to generate"
            />
            {reusableNumbers.data?.length ? (
              <div className="mt-3">
                <p className="mb-1 text-[12px] text-muted">Numbers of voided invoices you can use again:</p>
                <div className="flex flex-wrap gap-2">
                  {reusableNumbers.data.map((n) => (
                    <Button key={n} size="small" type={manualInvoiceNumber.trim() === n ? 'primary' : 'default'} className="font-mono" onClick={() => setManualInvoiceNumber(n)}>
                      {n}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-muted">Use a voided number only if that invoice was not sent to the client or reported in GSTR-1. Otherwise keep the next number.</p>
              </div>
            ) : null}
          </>
        ) : null}
      </Modal>

      <Modal
        title="Void Draft Invoice"
        open={voidOpen}
        onCancel={() => setVoidOpen(false)}
        onOk={() =>
          voidMutation.mutate({
            id: invoice.id,
            expectedVersion: invoice.version,
            reason: voidReason,
            accountingDate: undefined,
            idempotencyKey: voidKey,
          })
        }
        confirmLoading={voidMutation.isPending}
        okButtonProps={{ disabled: !voidReason.trim() }}
        okText="Void Draft"
      >
        <p className="mb-2 text-muted">
          {fromProforma ? 'Voiding this draft puts the proforma back. Nothing has been posted.' : 'Reason (required)'}
        </p>
        {fromProforma ? <p className="mb-2 text-muted">Reason (required)</p> : null}
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </Modal>
    </>
  );
}

function FinalizedOrVoidView({ invoice, projectId }: { invoice: InvoiceDetailData; projectId: string }) {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canVoid = permissions.includes('invoice.void');
  const canFinalize = permissions.includes('invoice.finalize');
  const canExport = permissions.includes('invoice.export');
  const canRecordPayment = permissions.includes('receipt.post');
  const canIssueNote = permissions.includes('credit_debit_note.create');

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [accountingDate, setAccountingDate] = useState('');
  const [voidKey, setVoidKey] = useState(newIdempotencyKey());
  const [downloading, setDownloading] = useState(false);

  const canMarkFullBill = canFinalize;
  const fullBillMutation = trpc.invoices.setCompletesSource.useMutation({
    onSuccess: async () => {
      message.success('Full bill undone. The payment alert is open again.');
      await utils.invoices.invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const voidMutation = trpc.invoices.void.useMutation({
    onSuccess: async () => {
      message.success('Invoice voided.');
      setVoidOpen(false);
      setVoidKey(newIdempotencyKey());
      await utils.invoices.getDetail.invalidate({ id: invoice.id });
    },
    onError: (error) => message.error(error.message),
  });

  const convertMutation = trpc.invoices.startConversion.useMutation({
    onSuccess: (created) => {
      router.push(`/projects/${projectId}/invoices/${created.id}`);
    },
    onError: (error) => message.error(error.message),
  });

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const result = await utils.invoices.getPdf.fetch({ id: invoice.id });
      downloadBase64Pdf(result.filename, result.base64);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not generate the PDF.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <UiCard
        title={invoice.status === 'ISSUED' || invoice.status === 'CONVERTED' ? `Proforma ${invoice.proformaNumber ?? ''}` : `Invoice ${invoice.invoiceNumber ?? ''}`}
        actions={
          <div className="flex gap-2">
            {canFinalize && invoice.status === 'ISSUED' ? (
              <Button
                size="small"
                type="primary"
                loading={convertMutation.isPending}
                onClick={() =>
                  convertMutation.mutate({ id: invoice.id, expectedVersion: invoice.version, idempotencyKey: newIdempotencyKey() })
                }
              >
                Convert to tax invoice
              </Button>
            ) : null}
            {canExport ? (
              <Button size="small" loading={downloading} onClick={downloadPdf}>
                Download PDF
              </Button>
            ) : null}
            {canRecordPayment && invoice.status === 'FINALIZED' ? (
              <Button size="small" type="primary" onClick={() => router.push(`/projects/${projectId}/receipts/new?invoiceId=${invoice.id}`)}>
                Record Payment
              </Button>
            ) : null}
            {canIssueNote && invoice.status === 'FINALIZED' ? (
              <Button size="small" onClick={() => router.push(`/projects/${projectId}/invoices/${invoice.id}/credit-debit-notes/new?type=CREDIT`)}>
                Issue Credit Note…
              </Button>
            ) : null}
            {canIssueNote && invoice.status === 'FINALIZED' ? (
              <Button size="small" onClick={() => router.push(`/projects/${projectId}/invoices/${invoice.id}/credit-debit-notes/new?type=DEBIT`)}>
                Issue Debit Note…
              </Button>
            ) : null}
            {canVoid && invoice.status === 'ISSUED' ? (
              <Button size="small" danger onClick={() => setVoidOpen(true)}>
                Void proforma…
              </Button>
            ) : null}
            {canVoid && invoice.status === 'FINALIZED' ? (
              <Button
                size="small"
                danger
                onClick={() => {
                  setAccountingDate(new Date().toISOString().slice(0, 10));
                  setVoidOpen(true);
                }}
              >
                Void…
              </Button>
            ) : null}
          </div>
        }
      >
        {invoice.status === 'ISSUED' ? (
          <p className="mb-3 text-[12.5px] text-muted">This proforma is not in the accounts. Convert it to open a tax invoice you can change. This proforma stays as it was.</p>
        ) : null}
        {invoice.status === 'CONVERTED' && invoice.convertedToInvoiceId ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-ui border border-brand bg-brand-soft px-4 py-3">
            <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
            <p className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">
              This proforma stays as it was.
              {invoice.convertedToStatus === 'FINALIZED' && invoice.convertedToInvoiceNumber
                ? ` Tax invoice ${invoice.convertedToInvoiceNumber} is in the accounts.`
                : ' The tax invoice is still a draft.'}
            </p>
            <Button size="small" onClick={() => router.push(`/projects/${projectId}/invoices/${invoice.convertedToInvoiceId}`)}>
              {invoice.convertedToStatus === 'DRAFT' ? 'Open tax invoice draft' : 'Open tax invoice'}
            </Button>
          </div>
        ) : null}
        {invoice.proformaNumber && invoice.status === 'FINALIZED' && !invoice.convertedFromInvoiceId ? (
          <p className="mb-3 text-[12.5px] text-muted">Converted from proforma {invoice.proformaNumber}. The receivable and GST were posted on this tax invoice.</p>
        ) : null}
        {invoice.convertedFromInvoiceId && invoice.status === 'FINALIZED' ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-ui border border-brand bg-brand-soft px-4 py-3">
            <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
            <p className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">
              From proforma {invoice.convertedFromProformaNumber}. The receivable and GST were posted on this tax invoice. The proforma stays as it was.
            </p>
            <Button size="small" onClick={() => router.push(`/projects/${projectId}/invoices/${invoice.convertedFromInvoiceId}`)}>
              View proforma
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Seller</p>
            <div className="text-[13px] text-ink">{invoice.sellerLegalName}</div>
            <div className="text-[12px] text-muted">PAN {invoice.sellerPan ?? '—'}</div>
            <div className="text-[12px] text-muted">GSTIN {invoice.sellerGstin ?? '—'}</div>
            <div className="text-[12px] text-muted">{invoice.sellerState ?? '—'}</div>
            <div className="text-[12px] text-muted">{invoice.sellerAddress ?? '—'}</div>
          </div>
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Buyer</p>
            <div className="text-[13px] text-ink">{invoice.buyerName}</div>
            <div className="text-[12px] text-muted">GSTIN {invoice.buyerGstin ?? '—'}</div>
            <div className="text-[12px] text-muted">{invoice.buyerState ?? '—'}</div>
            <div className="text-[12px] text-muted">{invoice.buyerAddress ?? '—'}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-y-2 text-[13.5px] md:grid-cols-4">
          <span className="text-muted">Invoice date</span>
          <span>{invoice.invoiceDate ? formatDate(invoice.invoiceDate) : '—'}</span>
          <span className="text-muted">Due date</span>
          <span>{invoice.dueDate ? formatDate(invoice.dueDate) : '—'}</span>
          {invoice.servicePeriodStart && invoice.servicePeriodEnd ? (
            <>
              <span className="text-muted">Service period</span>
              <span>
                {formatDate(invoice.servicePeriodStart)} – {formatDate(invoice.servicePeriodEnd)}
              </span>
            </>
          ) : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui text-left text-muted">
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">HSN/SAC</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3 text-right">Taxable</th>
                <th className="py-2 pr-3 text-right">GST%</th>
                <th className="py-2 pr-3 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id} className="border-b border-ui-2">
                  <td className="py-2 pr-3">{line.description}</td>
                  <td className="py-2 pr-3">{line.hsnSac ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.unitPrice)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.taxableAmount)}</td>
                  <td className="py-2 pr-3 text-right">{line.gstRatePercent}%</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto mt-4 w-full max-w-xs rounded-ui border border-ui">
          <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
            <span className="text-muted">Taxable</span>
            <span>{formatMoney(invoice.taxableAmount)}</span>
          </div>
          {invoice.cgstAmount && Number(invoice.cgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">CGST</span>
              <span>{formatMoney(invoice.cgstAmount)}</span>
            </div>
          ) : null}
          {invoice.sgstAmount && Number(invoice.sgstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">SGST</span>
              <span>{formatMoney(invoice.sgstAmount)}</span>
            </div>
          ) : null}
          {invoice.igstAmount && Number(invoice.igstAmount) > 0 ? (
            <div className="flex justify-between border-b border-ui-2 px-4 py-2 text-[13px]">
              <span className="text-muted">IGST</span>
              <span>{formatMoney(invoice.igstAmount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between px-4 py-2 text-[14px] font-semibold text-ink">
            <span>Total</span>
            <span>{formatMoney(invoice.totalAmount)}</span>
          </div>
        </div>

        {invoice.narrative ? (
          <div className="mt-4 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-ink">
            <b className="text-muted">Note:</b> {invoice.narrative}
          </div>
        ) : null}

        {invoice.status === 'FINALIZED' && invoice.completesSource ? (
          <p className="mt-4 text-[12.5px] text-muted">
            Marked as the full bill for its {invoice.milestoneType === 'OPEX' ? 'installment' : 'milestone event'}: nothing more is expected on it.
            {canMarkFullBill ? (
              <Popconfirm
                title="Undo full bill?"
                description="The amount left on it is expected again, and its payment alert reopens."
                okText="Undo"
                onConfirm={() => fullBillMutation.mutate({ id: invoice.id, completesSource: false, expectedVersion: invoice.version })}
              >
                <Button type="link" size="small" className="px-1" loading={fullBillMutation.isPending}>
                  Undo
                </Button>
              </Popconfirm>
            ) : null}
          </p>
        ) : null}
        {invoice.status === 'VOID' ? (
          <div className="mt-4 rounded-ui border border-ui bg-negative-soft p-3 text-[12.5px] text-negative">
            <b>Voided.</b> Reason: {invoice.voidReason ?? '—'} — {invoice.voidedAt ? formatDate(invoice.voidedAt) : '—'}
          </div>
        ) : null}
      </UiCard>

      <Modal
        title={invoice.status === 'ISSUED' ? 'Void proforma' : 'Void Finalized Invoice'}
        open={voidOpen}
        onCancel={() => setVoidOpen(false)}
        onOk={() =>
          voidMutation.mutate({
            id: invoice.id,
            expectedVersion: invoice.version,
            reason: voidReason,
            ...(invoice.status === 'FINALIZED' ? { accountingDate } : {}),
            idempotencyKey: voidKey,
          })
        }
        confirmLoading={voidMutation.isPending}
        okButtonProps={{ disabled: !voidReason.trim() || (invoice.status === 'FINALIZED' && !accountingDate) }}
        okText="Void Invoice"
      >
        <p className="mb-2 text-muted">
          {invoice.status === 'ISSUED'
            ? 'This withdraws the proforma. Nothing was posted, so there is no journal to reverse. The milestone can be billed again.'
            : 'This reverses the finalize journal entry and reopens the source payment alert. The invoice number is retained but the invoice can no longer be paid against.'}
        </p>
        {invoice.status === 'FINALIZED' && invoice.receipts.some((r) => r.receiptStatus === 'POSTED') ? (
          <div className="mb-3 rounded-ui border border-ui bg-warning-soft p-3 text-[12.5px] text-ink">
            <b>The payments on this invoice are reversed too</b>, on the same date:
            <ul className="my-1 list-disc pl-5">
              {invoice.receipts
                .filter((r) => r.receiptStatus === 'POSTED')
                .map((r) => (
                  <li key={r.allocationId}>
                    {formatDate(r.receiptDate)} · received {formatMoney(r.cashAllocated)}
                    {r.utrReference ? ` · ${r.utrReference}` : ''}
                  </li>
                ))}
            </ul>
            Record them again against the corrected invoice. A receipt that also pays another invoice is not reversed; voiding stops and says which.
          </div>
        ) : null}
        {invoice.status === 'FINALIZED' ? (
          <>
            <p className="mb-2 text-muted">Reversal accounting date</p>
            <DateInput value={accountingDate} onChange={setAccountingDate} />
          </>
        ) : null}
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </Modal>
    </>
  );
}

/**
 * What was billed and what came back on this invoice: the API's collection
 * (ADR-155), then each receipt with its deductions. Hold and retention are
 * released from here as well as from the receipt and the Payment tab.
 */
function PaymentsCard({ invoice, projectId }: { invoice: InvoiceDetailData; projectId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canRelease = permissions.includes('deduction.release');
  const canViewReceipt = permissions.includes('receipt.read');
  const [releasing, setReleasing] = useState<ReleaseDeductionTarget | null>(null);
  const c = invoice.collection;
  if (!c) return null;

  const figures: Array<[string, React.ReactNode]> = [
    ['Invoice total', formatMoney(c.invoiceTotal)],
    ['Credit / debit notes', <SettlementMoney key="cd" value={c.creditDebitNet} />],
    ['Received', <SettlementMoney key="r" value={c.received} />],
    ['TDS', <SettlementMoney key="t" value={c.tds} />],
    ['GST-TDS', <SettlementMoney key="g" value={c.gstTds} />],
    ['Hold', <SettlementMoney key="h" value={c.hold} />],
    ['Retention', <SettlementMoney key="rt" value={c.retention} />],
    ['Released', <SettlementMoney key="rl" value={c.released} />],
    ['Hold / retention to release', <SettlementMoney key="p" value={c.holdRetentionPending} />],
    ['Penalty', <SettlementMoney key="pn" value={c.penalty} />],
    ['Other deductions', <SettlementMoney key="o" value={c.otherDeductions} />],
    ['Outstanding', <OutstandingMoney key="out" value={c.outstanding} />],
  ];

  return (
    <UiCard title="Payments against this invoice" className="mt-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] md:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-ui-2 py-1.5">
            <span className="text-muted">{label}</span>
            <span className="text-right">{value}</span>
          </div>
        ))}
      </div>

      {invoice.receipts.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-muted">No payment has been recorded against this invoice yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-ui text-left text-muted">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Paying for</th>
                <th className="py-2 pr-3 text-right">Received</th>
                <th className="py-2 pr-3">Deductions</th>
                <th className="py-2 pr-3 text-right">Settled</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {invoice.receipts.map((r) => (
                <tr key={r.allocationId} className={`border-b border-ui-2 align-top ${r.receiptStatus === 'REVERSED' ? 'text-muted-2' : ''}`}>
                  <td className="py-2 pr-3">
                    {formatDate(r.receiptDate)}
                    {r.utrReference ? <div className="font-mono text-[11.5px] text-muted">{r.utrReference}</div> : null}
                  </td>
                  <td className="py-2 pr-3">{r.sourceEventName ?? 'Whole invoice'}</td>
                  <td className="py-2 pr-3 text-right">{formatMoney(r.cashAllocated)}</td>
                  <td className="py-2 pr-3">
                    {r.deductions.length === 0 ? <span className="text-muted-2">—</span> : null}
                    {r.deductions.map((d) => {
                      const recoverable = d.type === 'HOLD' || d.type === 'RETENTION';
                      const releasable = canRelease && recoverable && r.receiptStatus === 'POSTED' && Number(d.outstandingAmount) > 0;
                      return (
                        <div key={d.id} className="flex flex-wrap items-center gap-x-2 py-0.5">
                          <span>
                            {DEDUCTION_TYPE_LABEL[d.type] ?? d.type} {formatMoney(d.amount)}
                          </span>
                          {recoverable && Number(d.releasedAmount) > 0 ? (
                            <span className="text-[11.5px] text-muted">
                              released {formatMoney(d.releasedAmount)}, {formatMoney(d.outstandingAmount)} to go
                            </span>
                          ) : null}
                          {releasable ? (
                            <Button
                              size="small"
                              onClick={() =>
                                setReleasing({ id: d.id, type: d.type, outstandingAmount: d.outstandingAmount, invoiceNumber: invoice.invoiceNumber })
                              }
                            >
                              Release…
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </td>
                  <td className="py-2 pr-3 text-right">{formatMoney(r.settledAmount)}</td>
                  <td className="py-2 pr-3">
                    <ReceiptStatusTag status={r.receiptStatus} />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {canViewReceipt ? (
                      <Button size="small" onClick={() => router.push(`/projects/${projectId}/receipts/${r.receiptId}`)}>
                        View
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReleaseModal
        deduction={releasing}
        onClose={() => setReleasing(null)}
        onSuccess={() => {
          setReleasing(null);
          void utils.invoices.getDetail.invalidate({ id: invoice.id });
          void utils.receipts.getOutstandingDeductions.invalidate();
          void utils.invoices.listBySource.invalidate({ projectId });
        }}
      />
    </UiCard>
  );
}

function CreditDebitNotesCard({ projectId, invoiceId }: { projectId: string; invoiceId: string }) {
  const router = useRouter();
  const list = trpc.creditDebitNotes.list.useQuery({ page: 1, pageSize: 25, filters: { invoiceId } });
  const rows = (list.data?.rows ?? []) as CreditDebitNoteRow[];

  return (
    <UiCard title="Credit / Debit Notes" className="mt-4">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">No credit or debit notes have been issued against this invoice.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-ui text-left text-muted">
              <th className="py-2 pr-3">Note No.</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3 text-right">Total</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((note) => (
              <tr key={note.id} className="border-b border-ui-2">
                <td className="py-2 pr-3">{note.noteNumber ?? <span className="text-muted-2">Draft</span>}</td>
                <td className="py-2 pr-3">
                  <CreditDebitNoteTypeTag type={note.type} />
                </td>
                <td className="py-2 pr-3">{note.noteDate ? formatDate(note.noteDate) : '—'}</td>
                <td className="py-2 pr-3 text-right">{formatMoney(note.totalAmount)}</td>
                <td className="py-2 pr-3">
                  <CreditDebitNoteStatusTag status={note.status} />
                </td>
                <td className="py-2 pr-3 text-right">
                  <Button size="small" onClick={() => router.push(`/projects/${projectId}/invoices/${invoiceId}/credit-debit-notes/${note.id}`)}>
                    View
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </UiCard>
  );
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.id ?? '');
  const invoiceId = String(params.invoiceId ?? '');

  const detail = trpc.invoices.getDetail.useQuery({ id: invoiceId }, { enabled: !!invoiceId });

  // Error first: a failed query never has data, so checking `!data` first
  // would show "Loading…" forever instead of the error.
  if (detail.isError) {
    return <PageHeader title="Invoice" description="Could not load this invoice." />;
  }
  if (detail.isLoading || !detail.data) {
    return <PageHeader title="Invoice" description="Loading…" />;
  }

  const invoice = detail.data as InvoiceDetailData;

  return (
    <>
      <PageHeader
        title={
          invoice.status === 'ISSUED' || invoice.status === 'CONVERTED'
            ? `Proforma ${invoice.proformaNumber ?? ''}`
            : invoice.invoiceNumber
              ? `Invoice ${invoice.invoiceNumber}`
              : 'Draft Invoice'
        }
        description={invoice.sourceTitle}
        actions={
          <div className="flex items-center gap-2">
            <InvoiceStatusTag status={invoice.status} />
            <Button onClick={() => router.push(`/projects/${projectId}`)}>Back to Project</Button>
          </div>
        }
      />

      {invoice.status === 'DRAFT' ? <DraftEditor invoice={invoice} /> : <FinalizedOrVoidView invoice={invoice} projectId={projectId} />}

      {invoice.status === 'FINALIZED' ? <PaymentsCard invoice={invoice} projectId={projectId} /> : null}

      {invoice.status === 'FINALIZED' ? <CreditDebitNotesCard projectId={projectId} invoiceId={invoice.id} /> : null}

      {invoice.status === 'FINALIZED' ? (
        <UiCard title="Inward Copy (client acknowledgment)" className="mt-4">
          <DocumentsTab
            entityType="INVOICE"
            entityId={invoice.id}
            linkType={INVOICE_INWARD_COPY_LINK_TYPE}
            uploadCardTitle="Add Inward Copy"
            listCardTitle="Inward Copy"
            emptyText="Not yet received — can be added once the department returns the stamped inward copy."
          />
        </UiCard>
      ) : null}

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="INVOICE" entityId={invoice.id} />
      </UiCard>
    </>
  );
}
