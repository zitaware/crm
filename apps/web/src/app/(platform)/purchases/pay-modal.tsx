'use client';

import { useState } from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { MoneyInput } from '@zitaware/ui';
import type { PurchaseRow } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { DateInput } from '@/components/date-input';
import { BankAccountSelect } from '@/components/bank-account-select';
import { CardAccountSelect } from '@/components/card-account-select';
import { formatMoney } from '@/lib/format';
import { newIdempotencyKey } from '../vendor-bills/shared';

interface Values {
  amounts: Record<string, { amount: string; tds?: string }>;
  bankAccountId?: string;
  cardAccountId?: string;
  paymentModeId: string;
  paymentDate: string;
  utrReference?: string;
}

/** The account and mode last used for a legal entity, remembered in this browser only. */
const REMEMBER_KEY = 'zitaware-crm:purchases:last-payment-source';
export function rememberedSource(legalEntityId: string): { paymentModeId?: string; bankAccountId?: string; cardAccountId?: string } {
  try {
    const all = JSON.parse(window.localStorage.getItem(REMEMBER_KEY) ?? '{}') as Record<string, { paymentModeId?: string; bankAccountId?: string; cardAccountId?: string }>;
    return all[legalEntityId] ?? {};
  } catch {
    return {};
  }
}
export function rememberSource(legalEntityId: string, source: { paymentModeId?: string | undefined; bankAccountId?: string | undefined; cardAccountId?: string | undefined }) {
  try {
    const all = JSON.parse(window.localStorage.getItem(REMEMBER_KEY) ?? '{}') as Record<string, unknown>;
    all[legalEntityId] = source;
    window.localStorage.setItem(REMEMBER_KEY, JSON.stringify(all));
  } catch {
    // Remembering is a convenience only.
  }
}

/**
 * Pays approved bills of one vendor and legal entity (ADR-176). Each bill
 * starts at what is left to pay; TDS is withheld from it. The money leaves a
 * bank account, or a credit card's payable (ADR-179). The API makes the
 * payment request and posts the payment.
 */
export function PayModal({ bills, onClose, onPaid }: { bills: PurchaseRow[]; onClose: () => void; onPaid: () => Promise<void> }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const [key] = useState(newIdempotencyKey);
  const legalEntityId = bills[0]!.legalEntityId;
  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });
  const paymentModeId = Form.useWatch('paymentModeId', form);
  const mode = (paymentModes.data ?? []).find((m) => m.id === paymentModeId);
  const byCreditCard = mode?.code === 'CREDIT_CARD';
  const [remembered] = useState(() => rememberedSource(legalEntityId));
  const pay = trpc.purchases.pay.useMutation({
    onSuccess: async (result) => {
      message.success(`Paid ${formatMoney(result.cashPaid)} to ${bills[0]!.vendorName}.`);
      await onPaid();
      onClose();
    },
    onError: (e) => message.error(e.message),
  });

  const submit = (v: Values) => {
    rememberSource(legalEntityId, { paymentModeId: v.paymentModeId, ...(byCreditCard ? { cardAccountId: v.cardAccountId } : { bankAccountId: v.bankAccountId }) });
    pay.mutate({
      lines: bills.map((b) => ({
        vendorBillId: b.vendorBillId,
        amount: v.amounts[b.vendorBillId]!.amount,
        tdsAmount: v.amounts[b.vendorBillId]?.tds || undefined,
      })),
      ...(byCreditCard ? { cardAccountId: v.cardAccountId } : { bankAccountId: v.bankAccountId }),
      paymentModeId: v.paymentModeId,
      paymentDate: v.paymentDate,
      utrReference: v.utrReference?.trim() || undefined,
      idempotencyKey: key,
    });
  };

  return (
    <Modal
      open
      title={`Pay ${bills[0]!.vendorName}`}
      okText="Post payment"
      onCancel={onClose}
      confirmLoading={pay.isPending}
      onOk={() => form.submit()}
      width={720}
      destroyOnHidden
    >
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark
        onFinish={submit}
        initialValues={{
          amounts: Object.fromEntries(bills.map((b) => [b.vendorBillId, { amount: b.dueAmount }])),
          paymentDate: new Date().toISOString().slice(0, 10),
          ...remembered,
        }}
      >
        <table className="mb-4 w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ui text-left text-muted">
              <th className="py-1.5 pr-3 font-medium">Bill</th>
              <th className="py-1.5 pr-3 text-right font-medium">Left to pay</th>
              <th className="py-1.5 pr-3 font-medium">Settle now</th>
              <th className="py-1.5 font-medium">TDS withheld</th>
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.vendorBillId} className="border-b border-ui-2 align-top last:border-b-0">
                <td className="py-2 pr-3">
                  <div className="font-semibold text-ink">{b.vendorBillNumber}</div>
                  <div className="text-[11.5px] text-muted">{b.projectName ?? 'Company overhead'}</div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(b.dueAmount)}</td>
                <td className="py-2 pr-3">
                  <Form.Item className="mb-0" name={['amounts', b.vendorBillId, 'amount']} rules={[{ required: true, message: 'Amount?' }]}>
                    <MoneyInput placeholder="0.00" />
                  </Form.Item>
                </td>
                <td className="py-2">
                  <Form.Item className="mb-0" name={['amounts', b.vendorBillId, 'tds']}>
                    <MoneyInput placeholder="0.00" />
                  </Form.Item>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="-mt-2 mb-3 text-[12px] text-muted">
          {byCreditCard
            ? 'The card pays “settle now” less TDS; it is owed on the card until the card bill is settled in Card Accounts.'
            : 'The bank pays “settle now” less TDS; the TDS is owed to the government.'}
        </p>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Form.Item label="Payment mode" name="paymentModeId" rules={[{ required: true, message: 'Payment mode?' }]}>
            <Select
              placeholder="Select…"
              loading={paymentModes.isLoading}
              options={(paymentModes.data ?? []).filter((m) => !m.requiresCardSource || m.code === 'CREDIT_CARD').map((m) => ({ value: m.id, label: m.label }))}
            />
          </Form.Item>
          {byCreditCard ? (
            <Form.Item label="Credit card" name="cardAccountId" rules={[{ required: true, message: 'Card?' }]}>
              <CardAccountSelect legalEntityId={legalEntityId} cardType="CREDIT_CARD" placeholder="Select…" />
            </Form.Item>
          ) : (
            <Form.Item label="From bank account" name="bankAccountId" rules={[{ required: true, message: 'Bank account?' }]}>
              <BankAccountSelect legalEntityId={legalEntityId} placeholder="Select…" />
            </Form.Item>
          )}
          <Form.Item label="Payment date" name="paymentDate" rules={[{ required: true, message: 'Date?' }]}>
            <DateInput />
          </Form.Item>
          <Form.Item label="UTR / reference" name="utrReference">
            <Input placeholder="e.g. UTR number" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
