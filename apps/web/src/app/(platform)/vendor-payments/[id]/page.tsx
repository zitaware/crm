'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { App, Button, Input, Modal } from 'antd';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { DEDUCTION_TYPE_LABEL, VendorPaymentStatusTag, newIdempotencyKey, type VendorPaymentDetailData } from '../shared';
import { DateInput } from '@/components/date-input';

export default function VendorPaymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? '');
  const { message } = App.useApp();

  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canReverse = permissions.includes('vendor_payment.reverse');

  const utils = trpc.useUtils();
  const detail = trpc.vendorPayments.getDetail.useQuery({ id }, { enabled: !!id });

  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [accountingDate, setAccountingDate] = useState('');
  const [reverseKey, setReverseKey] = useState(newIdempotencyKey());

  const invalidate = () => utils.vendorPayments.getDetail.invalidate({ id });

  const reverseMutation = trpc.vendorPayments.reverseVendorPayment.useMutation({
    onSuccess: async () => {
      message.success('Vendor payment reversed.');
      setReverseOpen(false);
      setReverseKey(newIdempotencyKey());
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  if (detail.isError) return <PageHeader title="Vendor Payment" description="Could not load this vendor payment." />;
  if (detail.isLoading || !detail.data) return <PageHeader title="Vendor Payment" description="Loading…" />;

  const payment = detail.data as VendorPaymentDetailData;

  return (
    <>
      <PageHeader
        title={`Vendor Payment — ${payment.vendorName}`}
        description={payment.vendorBillNumbers.join(', ')}
        actions={
          <div className="flex items-center gap-2">
            <VendorPaymentStatusTag status={payment.status} />
            {canReverse && payment.status === 'POSTED' ? (
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
            <Button onClick={() => router.push('/vendor-payments')}>Back to list</Button>
          </div>
        }
      />

      <UiCard title="Payment Details">
        <div className="grid grid-cols-2 gap-y-2 text-[13.5px] md:grid-cols-4">
          <span className="text-muted">Payment date</span>
          <span>{formatDate(payment.paymentDate)}</span>
          <span className="text-muted">Legal entity</span>
          <span>{payment.legalEntityName}</span>
          <span className="text-muted">Bank account</span>
          <span>{payment.bankAccountName ?? (payment.cardAccountLabel ? `Credit card ${payment.cardAccountLabel}` : '—')}</span>
          <span className="text-muted">Payment mode</span>
          <span>{payment.paymentModeLabel}</span>
          <span className="text-muted">UTR / Reference</span>
          <span>{payment.utrReference ?? '—'}</span>
          <span className="text-muted">Actual amount</span>
          <span className="font-semibold text-ink">{formatMoney(payment.actualAmount)}</span>
        </div>
        {payment.status === 'REVERSED' ? (
          <div className="mt-4 rounded-ui border border-ui bg-negative-soft p-3 text-[12.5px] text-negative">
            <b>Reversed.</b> Reason: {payment.reversalReason ?? '—'} — {payment.reversedAt ? formatDate(payment.reversedAt) : '—'}
          </div>
        ) : null}
      </UiCard>

      {payment.allocations.map((allocation) => (
        <UiCard key={allocation.id} title={`Vendor Bill ${allocation.vendorBillNumber}`} className="mt-4">
          <div className="grid grid-cols-2 gap-2 text-[12.5px] text-muted md:grid-cols-4">
            <span>Request {allocation.requestNumber ?? '—'}</span>
            <span>Taxable {formatMoney(allocation.vendorBillTaxableAmountSnapshot)}</span>
            <span>Requested {formatMoney(allocation.requestedAmountSnapshot)}</span>
            <span className="font-semibold text-ink">Settled {formatMoney(allocation.settledAmount)}</span>
          </div>
          <div className="mt-3 flex justify-between text-[13.5px]">
            <span className="text-muted">Cash paid</span>
            <span className="font-semibold text-ink">{formatMoney(allocation.cashPaid)}</span>
          </div>

          {allocation.deductions.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-ui text-left text-muted">
                    <th className="py-1.5 pr-3">Type</th>
                    <th className="py-1.5 pr-3 text-right">Rate %</th>
                    <th className="py-1.5 pr-3 text-right">Amount</th>
                    <th className="py-1.5 pr-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {allocation.deductions.map((d) => (
                    <tr key={d.id} className="border-b border-ui-2">
                      <td className="py-1.5 pr-3">{DEDUCTION_TYPE_LABEL[d.type]}</td>
                      <td className="py-1.5 pr-3 text-right">{d.ratePercent ?? '—'}</td>
                      <td className="py-1.5 pr-3 text-right">{formatMoney(d.amount)}</td>
                      <td className="py-1.5 pr-3">{d.narrative ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </UiCard>
      ))}

      <Modal
        title="Reverse Vendor Payment"
        open={reverseOpen}
        onCancel={() => setReverseOpen(false)}
        onOk={() =>
          reverseMutation.mutate({
            id: payment.id,
            expectedVersion: payment.version,
            reason: reverseReason,
            accountingDate,
            idempotencyKey: reverseKey,
          })
        }
        confirmLoading={reverseMutation.isPending}
        okButtonProps={{ disabled: !reverseReason.trim() || !accountingDate }}
        okText="Reverse Payment"
      >
        <p className="mb-2 text-muted">This reverses the journal entry. The payment record and its allocations are kept for history.</p>
        <p className="mb-2 text-muted">Reversal accounting date</p>
        <DateInput value={accountingDate} onChange={setAccountingDate} />
        <p className="mb-2 mt-3 text-muted">Reason (required)</p>
        <Input.TextArea rows={3} value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
      </Modal>
    </>
  );
}
