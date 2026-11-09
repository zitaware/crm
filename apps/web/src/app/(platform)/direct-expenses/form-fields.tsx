'use client';

import type { FormInstance } from 'antd';
import { Form, Input, Segmented, Select } from 'antd';
import { MoneyInput } from '@zitaware/ui';
import { MasterSelect } from '@/components/master-select';
import { trpc } from '@/server/trpc';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { EmployeeSelect } from '@/components/employee-select';
import { ProjectSelect } from '@/components/project-select';
import { VendorSelect } from '@/components/vendor-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { CardAccountSelect } from '@/components/card-account-select';
import { DateInput } from '@/components/date-input';

export interface DirectExpenseFormValues {
  expenseCategoryId: string;
  vendorId?: string;
  title: string;
  projectId?: string;
  legalEntityId?: string;
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
  spendType?: 'SERVER' | 'SUBSCRIPTION';
  billUrl?: string;
}

const SUPPLY_TYPE_OPTIONS = [
  { label: 'Intrastate (CGST + SGST)', value: 'INTRASTATE' },
  { label: 'Interstate (IGST)', value: 'INTERSTATE' },
];

/** Shared field set for both the create form and the draft editor — the two
 * pages differ only in header, initial values and submit actions. Keeping
 * this one place avoids re-deriving the GST/Card conditional-field logic
 * twice as it evolves. */
export function DirectExpenseFormFields({ form }: { form: FormInstance<DirectExpenseFormValues> }) {
  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });

  const gstInvoiceAvailable = Form.useWatch('gstInvoiceAvailable', form);
  const paymentModeId = Form.useWatch('paymentModeId', form);
  // The legal entity narrows the projects, employees, accounts and cards (ADR-183).
  const legalEntityId = Form.useWatch('legalEntityId', form);

  const selectedPaymentMode = (paymentModes.data ?? []).find((m) => m.id === paymentModeId);
  const requiresCardSource = selectedPaymentMode?.requiresCardSource ?? false;
  const cardType = selectedPaymentMode?.code === 'DEBIT_CARD' ? 'DEBIT_CARD' : selectedPaymentMode?.code === 'CREDIT_CARD' ? 'CREDIT_CARD' : undefined;

  return (
    <>
      <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">Expense Details</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Form.Item label="Category" name="expenseCategoryId" rules={[{ required: true, message: 'Category is required.' }]}>
          <MasterSelect type="expense_categories" placeholder="Select category…" />
        </Form.Item>
        <Form.Item label="Vendor (optional)" name="vendorId">
          <VendorSelect allowClear placeholder="None" />
        </Form.Item>
        <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Title is required.' }]}>
          <Input placeholder="e.g. Office internet — August" />
        </Form.Item>
        <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]}>
          <LegalEntitySelect
            onUserChange={() => form.resetFields(['projectId', 'purchasedByEmployeeId', 'bankAccountId', 'cardAccountId'])}
          />
        </Form.Item>
        <Form.Item label="Project (optional)" name="projectId">
          <ProjectSelect legalEntityId={legalEntityId} allowClear placeholder="None / company overhead" disabled={!legalEntityId} />
        </Form.Item>
        <Form.Item label="Taxable amount" name="taxableAmount" extra="Base amount before GST." rules={[{ required: true, message: 'Taxable amount is required.' }]}>
          <MoneyInput placeholder="0.00" />
        </Form.Item>
        <Form.Item label="Expense date" name="expenseDate" rules={[{ required: true, message: 'Expense date is required.' }]}>
          <DateInput />
        </Form.Item>
        <Form.Item label="Purchased by (optional)" name="purchasedByEmployeeId">
          <EmployeeSelect allowClear placeholder="None" legalEntityId={legalEntityId} />
        </Form.Item>
        <Form.Item label="Server / Subscription (optional)" name="spendType" extra="Tag a server or subscription bill so it shows under Servers & Subscriptions and on the project.">
          <Select
            allowClear
            placeholder="Neither"
            options={[
              { value: 'SERVER', label: 'Server' },
              { value: 'SUBSCRIPTION', label: 'Subscription' },
            ]}
          />
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
            <Form.Item label="ITC eligible?" name="itcEligible" extra="If no, the GST amount folds into the expense instead of Input GST Receivable.">
              <Segmented
                options={[
                  { label: 'Yes', value: true },
                  { label: 'No', value: false },
                ]}
              />
            </Form.Item>
          </>
        ) : null}
        <Form.Item label="TDS amount (optional)" name="tdsAmount" extra="Deducted from the payment; credited to TDS Payable.">
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
            <CardAccountSelect legalEntityId={legalEntityId} cardType={cardType} disabled={!legalEntityId} placeholder={legalEntityId ? 'Select card…' : 'Choose the legal entity first'} />
          </Form.Item>
        ) : (
          <Form.Item label="Bank account" name="bankAccountId" rules={[{ required: true, message: 'Bank account is required.' }]}>
            <BankAccountSelect legalEntityId={legalEntityId} disabled={!legalEntityId} placeholder={legalEntityId ? 'Select account…' : 'Choose the legal entity first'} />
          </Form.Item>
        )}
        <Form.Item label="Transaction reference (optional)" name="transactionReference">
          <Input placeholder="UTR / reference number" />
        </Form.Item>
      </div>

      <Form.Item
        label="Bill link (optional)"
        name="billUrl"
        extra="A web address of the bill (vendor portal, Google Drive). Upload the bill file under Documents."
        rules={[{ pattern: /^https?:\/\/\S+$/i, message: 'A web address starting with https://.' }]}
      >
        <Input placeholder="https://…" inputMode="url" />
      </Form.Item>
      <Form.Item label="Note" name="note">
        <Input.TextArea rows={2} placeholder="Optional" />
      </Form.Item>
    </>
  );
}
