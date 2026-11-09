'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Input, Modal } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { DocumentsTab } from '@/components/documents-tab';
import {
  DEDUCTION_TYPE_LABEL,
  ReceiptStatusTag,
  ReleaseModal,
  newIdempotencyKey,
  type ClientReceiptDetailData,
  type ReleaseDeductionTarget,
} from '../../../../payment-integration/shared';
import { DateInput } from '@/components/date-input';

function isZeroMoney(value: string | null | undefined): boolean {
  return !value || /^0+(\.0+)?$/.test(value.trim());
}

const DEDUCTION_PLAIN_LABEL: Record<string, string> = {
  TDS: 'TDS',
  CGST_TDS: 'GST-TDS, CGST',
  SGST_TDS: 'GST-TDS, SGST',
  IGST_TDS: 'GST-TDS, IGST',
  HOLD: 'Hold',
  RETENTION: 'Retention',
  ACCEPTED_PENALTY: 'Penalty',
  DISPUTED_PENALTY: 'Disputed penalty',
  OTHER: 'Other deduction',
};

function deductionNote(
  deduction: ClientReceiptDetailData['allocations'][number]['deductions'][number],
  taxable: string | null,
): string {
  if (deduction.ratePercent) {
    const rate = Number(deduction.ratePercent);
    const rateLabel = Number.isInteger(rate) ? String(rate) : String(rate);
    return `${rateLabel}% of the taxable amount ${formatMoney(taxable)}`;
  }
  if (deduction.type === 'RETENTION') return 'Kept back on this receipt. Release it when it becomes due.';
  if (deduction.type === 'HOLD') return 'Held on this receipt. Release it when it becomes due.';
  return deduction.penaltyCategoryName ?? deduction.otherLedgerAccountName ?? deduction.narrative ?? 'Taken out of the amount applied to the invoice.';
}

export default function ReceiptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.id ?? '');
  const receiptId = String(params.receiptId ?? '');
  const { message } = App.useApp();

  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canReverse = permissions.includes('receipt.reverse');
  const canRelease = permissions.includes('deduction.release');

  const utils = trpc.useUtils();
  const detail = trpc.receipts.getDetail.useQuery({ id: receiptId }, { enabled: !!receiptId });

  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [accountingDate, setAccountingDate] = useState('');
  const [reverseKey, setReverseKey] = useState(newIdempotencyKey());
  const [releasingDeduction, setReleasingDeduction] = useState<ReleaseDeductionTarget | null>(null);

  const invalidate = () => utils.receipts.getDetail.invalidate({ id: receiptId });

  const reverseMutation = trpc.receipts.reverseReceipt.useMutation({
    onSuccess: async () => {
      message.success('Receipt reversed.');
      setReverseOpen(false);
      setReverseKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  if (detail.isError) return <PageHeader title="Receipt" description="Could not load this receipt." />;
  if (detail.isLoading || !detail.data) return <PageHeader title="Receipt" description="Loading…" />;

  const receipt = detail.data as ClientReceiptDetailData;

  return (
    <>
      <PageHeader
        title={`Receipt — ${receipt.clientName}`}
        description={receipt.invoiceNumbers.join(', ')}
        actions={
          <div className="flex items-center gap-2">
            <ReceiptStatusTag status={receipt.status} />
            {canReverse && receipt.status === 'POSTED' ? (
              <Button
                danger
                onClick={() => {
                  setAccountingDate(new Date().toISOString().slice(0, 10));
                  setReverseOpen(true);
                }}
              >
                Reverse…
              </Button>
            ) : null}
            <Button onClick={() => router.push(`/projects/${projectId}`)}>Back to Project</Button>
          </div>
        }
      />

      <UiCard title="Receipt Details">
        <div className="grid grid-cols-2 gap-y-2 text-[13.5px] md:grid-cols-4">
          <span className="text-muted">Receipt date</span>
          <span>{formatDate(receipt.receiptDate)}</span>
          <span className="text-muted">Bank account</span>
          <span>{receipt.bankAccountName}</span>
          <span className="text-muted">Payment mode</span>
          <span>{receipt.paymentModeLabel}</span>
          <span className="text-muted">UTR / Reference</span>
          <span>{receipt.utrReference ?? '—'}</span>
          <span className="text-muted">Received in bank</span>
          <span className="font-semibold text-ink">{formatMoney(receipt.actualAmount)}</span>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">Deductions come out of the amount applied to the invoice. The bank receives what is left.</p>
        {receipt.status === 'REVERSED' ? (
          <div className="mt-4 rounded-ui border border-ui bg-negative-soft p-3 text-[12.5px] text-negative">
            <b>Reversed.</b> Reason: {receipt.reversalReason ?? '—'} — {receipt.reversedAt ? formatDate(receipt.reversedAt) : '—'}
          </div>
        ) : null}
      </UiCard>

      {receipt.allocations.map((allocation) => (
        <UiCard
          key={allocation.id}
          title={`Invoice ${allocation.invoiceNumber ?? ''}${allocation.sourceEventName ? ` · ${allocation.sourceEventName}` : ''}`}
          actions={
            <Link href={`/projects/${allocation.invoiceProjectId}/invoices/${allocation.invoiceId}`} className="text-[12.5px] text-brand hover:underline">
              Open invoice ↗
            </Link>
          }
          className="mt-4"
        >
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
            <span>
              Taxable <span className="font-medium text-ink">{formatMoney(allocation.invoiceTaxableAmountSnapshot)}</span>
            </span>
            {!isZeroMoney(allocation.invoiceCgstSnapshot) ? (
              <span>
                CGST <span className="font-medium text-ink">{formatMoney(allocation.invoiceCgstSnapshot)}</span>
              </span>
            ) : null}
            {!isZeroMoney(allocation.invoiceSgstSnapshot) ? (
              <span>
                SGST <span className="font-medium text-ink">{formatMoney(allocation.invoiceSgstSnapshot)}</span>
              </span>
            ) : null}
            {!isZeroMoney(allocation.invoiceIgstSnapshot) ? (
              <span>
                IGST <span className="font-medium text-ink">{formatMoney(allocation.invoiceIgstSnapshot)}</span>
              </span>
            ) : null}
            <span>
              Invoice total <span className="font-semibold text-ink">{formatMoney(allocation.invoiceTotalSnapshot)}</span>
            </span>
          </div>

          <div className="mt-4 overflow-hidden rounded-ui border border-ui">
            <div className="flex items-center justify-between gap-4 bg-ui-2 px-4 py-3">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Settles the invoice</div>
                <div className="text-[13px] text-muted">Amount applied to this invoice.</div>
              </div>
              <div className="text-[20px] font-semibold text-ink">{formatMoney(allocation.settledAmount)}</div>
            </div>

            {allocation.deductions.map((d) => {
              const canReleaseRow =
                canRelease && (d.type === 'HOLD' || d.type === 'RETENTION') && !isZeroMoney(d.outstandingAmount) && receipt.status === 'POSTED';
              const partlyReleased = !isZeroMoney(d.releasedAmount);
              return (
                <div key={d.id} className="flex items-start justify-between gap-4 border-t border-ui px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-ink">{DEDUCTION_PLAIN_LABEL[d.type] ?? DEDUCTION_TYPE_LABEL[d.type]}</div>
                    <div className="text-[12.5px] text-muted">{deductionNote(d, allocation.invoiceTaxableAmountSnapshot)}</div>
                    {partlyReleased ? (
                      <div className="text-[12.5px] text-muted">
                        Released {formatMoney(d.releasedAmount)}. Still to release {formatMoney(d.outstandingAmount)}.
                      </div>
                    ) : null}
                    {canReleaseRow ? (
                      <Button
                        className="mt-2"
                        size="small"
                        onClick={() =>
                          setReleasingDeduction({
                            id: d.id,
                            type: d.type,
                            outstandingAmount: d.outstandingAmount,
                            invoiceNumber: allocation.invoiceNumber,
                          })
                        }
                      >
                        Release
                      </Button>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-[15px] font-medium text-ink">− {formatMoney(d.amount)}</div>
                </div>
              );
            })}

            <div className="flex items-center justify-between gap-4 border-t border-ui bg-brand-soft px-4 py-3">
              <div>
                <div className="text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Bank received</div>
                <div className="text-[13px] text-ink">What remained after the deductions.</div>
              </div>
              <div className="text-[20px] font-semibold text-ink">{formatMoney(allocation.cashAllocated)}</div>
            </div>
          </div>
        </UiCard>
      ))}

      <UiCard title="Documents" className="mt-4">
        <DocumentsTab entityType="RECEIPT" entityId={receipt.id} />
      </UiCard>

      <Modal
        title="Reverse Receipt"
        open={reverseOpen}
        onCancel={() => setReverseOpen(false)}
        onOk={() =>
          reverseMutation.mutate({
            id: receipt.id,
            expectedVersion: receipt.version,
            reason: reverseReason,
            accountingDate,
            idempotencyKey: reverseKey,
          })
        }
        confirmLoading={reverseMutation.isPending}
        okButtonProps={{ disabled: !reverseReason.trim() || !accountingDate }}
        okText="Reverse Receipt"
      >
        <p className="mb-2 text-muted">This reverses the journal entry. The receipt record and its allocations are kept for history.</p>
        <p className="mb-2 text-muted">Reversal accounting date</p>
        <DateInput value={accountingDate} onChange={setAccountingDate} />
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
      </Modal>

      <ReleaseModal
        deduction={releasingDeduction}
        onClose={() => setReleasingDeduction(null)}
        onSuccess={() => {
          setReleasingDeduction(null);
          void invalidate();
        }}
      />
    </>
  );
}
