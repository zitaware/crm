'use client';

import type { FormInstance } from 'antd';
import { Form, Input, Segmented, Select } from 'antd';
import { MoneyInput } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { EmployeeSelect } from '@/components/employee-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { CardAccountSelect } from '@/components/card-account-select';
import { DateInput } from '@/components/date-input';

export interface RecordCyclePaymentFormValues {
  chargeToProjectId?: string;
  taxableAmount: string;
  expenseDate: string;
  gstInvoiceAvailable: boolean;
  gstRatePercent?: string;
  supplyType?: 'INTRASTATE' | 'INTERSTATE';
  itcEligible?: boolean;
  tdsAmount?: string;
  tdsRatePercent?: string;
  paymentModeId: string;
  bankAccountId?: string;
  cardAccountId?: string;
  transactionReference?: string;
  purchasedByEmployeeId?: string;
  note?: string;
}

const SUPPLY_TYPE_OPTIONS = [
  { label: 'Intrastate (CGST + SGST)', value: 'INTRASTATE' },
  { label: 'Interstate (IGST)', value: 'INTERSTATE' },
];

/** Shared Record Payment field set for both Subscription and Server cycles
 * (docs/12 ADR-088) — the same conditional GST/Card logic Direct Expense's
 * own form-fields.tsx already established, since a cycle payment IS a
 * Direct Expense underneath. chargeToProjects, when passed (Server only),
 * renders the "Charge to" project-or-overhead picker. */
export function RecordCyclePaymentFields({
  form,
  chargeToProjects,
}: {
  form: FormInstance<RecordCyclePaymentFormValues>;
  chargeToProjects?: Array<{ id: string; name: string }>;
}) {
  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });

  const gstInvoiceAvailable = Form.useWatch('gstInvoiceAvailable', form);
  const paymentModeId = Form.useWatch('paymentModeId', form);

  const selectedPaymentMode = (paymentModes.data ?? []).find((m) => m.id === paymentModeId);
  const requiresCardSource = selectedPaymentMode?.requiresCardSource ?? false;
  const cardType = selectedPaymentMode?.code === 'DEBIT_CARD' ? 'DEBIT_CARD' : selectedPaymentMode?.code === 'CREDIT_CARD' ? 'CREDIT_CARD' : undefined;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Form.Item label="Actual amount (taxable)" name="taxableAmount" rules={[{ required: true, message: 'Amount is required.' }]}>
          <MoneyInput placeholder="0.00" />
        </Form.Item>
        <Form.Item label="Payment date" name="expenseDate" rules={[{ required: true, message: 'Payment date is required.' }]}>
          <DateInput />
        </Form.Item>
        {chargeToProjects ? (
          <Form.Item label="Charge to" name="chargeToProjectId" extra="Leave unselected for company overhead.">
            <Select allowClear placeholder="Company overhead" options={chargeToProjects.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
        ) : null}
        <Form.Item label="Purchased by (optional)" name="purchasedByEmployeeId">
          <EmployeeSelect allowClear placeholder="None" />
        </Form.Item>
      </div>

      <p className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Tax</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Form.Item label="GST invoice available?" name="gstInvoiceAvailable">
          <Segmented
            options={[
              { label: 'Yes', value: true },
              { label: 'No', value: false },
            ]}
          />
        </Form.Item>
        {gstInvoiceAvailable ? (
          <>
            <Form.Item label="GST rate %" name="gstRatePercent" extra="Same state: this percent is CGST and this percent is SGST. A different state charges twice this percent as IGST." rules={[{ required: true, message: 'GST rate is required.' }]}>
              <Input type="number" min={0} max={100} step={0.01} placeholder="e.g. 9" />
            </Form.Item>
            <Form.Item label="Supply type" name="supplyType" rules={[{ required: true, message: 'Supply type is required.' }]}>
              <Select options={SUPPLY_TYPE_OPTIONS} placeholder="Select…" />
            </Form.Item>
            <Form.Item label="ITC eligible?" name="itcEligible">
              <Segmented
                options={[
                  { label: 'Yes', value: true },
                  { label: 'No', value: false },
                ]}
              />
            </Form.Item>
          </>
        ) : null}
        <Form.Item label="TDS amount (optional)" name="tdsAmount">
          <MoneyInput placeholder="0.00" />
        </Form.Item>
        <Form.Item label="TDS rate % (optional, display only)" name="tdsRatePercent">
          <Input type="number" min={0} max={100} step={0.01} placeholder="e.g. 10" />
        </Form.Item>
      </div>

      <p className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Payment Source</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Form.Item label="Payment mode" name="paymentModeId" rules={[{ required: true, message: 'Payment mode is required.' }]}>
          <Select
            loading={paymentModes.isLoading}
            options={(paymentModes.data ?? []).map((m) => ({ value: m.id, label: m.label }))}
            placeholder="Select mode…"
            onChange={() => {
              form.setFieldValue('bankAccountId', undefined);
              form.setFieldValue('cardAccountId', undefined);
            }}
          />
        </Form.Item>
        {requiresCardSource ? (
          <Form.Item label={cardType === 'CREDIT_CARD' ? 'Credit card' : 'Debit card'} name="cardAccountId" rules={[{ required: true, message: 'A card is required for this payment mode.' }]}>
            <CardAccountSelect cardType={cardType} />
          </Form.Item>
        ) : (
          <Form.Item label="Bank account" name="bankAccountId" rules={[{ required: true, message: 'Bank account is required.' }]}>
            <BankAccountSelect />
          </Form.Item>
        )}
        <Form.Item label="Transaction reference (optional)" name="transactionReference">
          <Input placeholder="UTR / reference number" />
        </Form.Item>
      </div>

      <Form.Item label="Note" name="note">
        <Input.TextArea rows={2} placeholder="Optional" />
      </Form.Item>
    </>
  );
}
