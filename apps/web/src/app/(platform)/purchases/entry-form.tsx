'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Form, Input, Select, Upload } from 'antd';
import { MoneyInput, UiCard } from '@zitaware/ui';
import type { PurchaseEntryInput } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { VendorSelect } from '@/components/vendor-select';
import { LegalEntitySelect } from '@/components/legal-entity-select';
import { ProjectSelect } from '@/components/project-select';
import { BankAccountSelect } from '@/components/bank-account-select';
import { CardAccountSelect } from '@/components/card-account-select';
import { DateInput } from '@/components/date-input';
import { useUploadAndLink } from '@/lib/upload-document';
import { newIdempotencyKey } from '../vendor-bills/shared';
import { rememberSource, rememberedSource } from './pay-modal';

/** A category typed that is not in Masters travels as its name, and the API adds it (ADR-180). */
const NEW_CATEGORY = 'new:';

type Values = Omit<PurchaseEntryInput, 'expenseCategoryId' | 'categoryName' | 'gstSplit'> & {
  category?: string;
  gstSplit?: 'AUTO' | 'CGST_SGST' | 'IGST';
};

const Section = ({ children }: { children: string }) => (
  <p className="mb-2 mt-1 text-[12px] font-bold uppercase tracking-[.06em] text-muted-2">{children}</p>
);

/**
 * One purchase, entered as a row of the purchase register (ADR-181): the
 * sheet's columns in the sheet's order. It is checked and posted the way an
 * imported row is: an approved bill, paid from the card or account given.
 * Left without a payment mode, the bill waits in "To pay".
 */
export function PurchaseEntryForm() {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<Values>();
  const [key] = useState(newIdempotencyKey);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const uploadAndLink = useUploadAndLink();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canPay = permissions.includes('vendor_payment.post');
  const canAttach = permissions.includes('document.upload') && permissions.includes('document.manage');

  const categories = trpc.masters.list.useQuery({ type: 'expense_categories', includeInactive: false });
  const paymentModes = trpc.documentSupport.listPaymentModes.useQuery({ includeInactive: false });
  // The same list the card picker loads, only to say when this company has no card of the type.
  const cardAccounts = trpc.legalEntities.listCardAccounts.useQuery({ includeInactive: true });

  const legalEntityId = Form.useWatch('legalEntityId', form);
  const paymentModeId = Form.useWatch('paymentModeId', form);
  const mode = (paymentModes.data ?? []).find((m) => m.id === paymentModeId);

  const byName = <T,>(rows: T[], name: (r: T) => string) => [...rows].sort((a, b) => name(a).localeCompare(name(b)));
  // Matched as the API matches: ignoring case and spaces.
  const looseKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const typed = categorySearch.replace(/\s+/g, ' ').trim();
  const categoryOptions = byName(categories.data ?? [], (c) => c.name).map((c) => ({ value: c.id, label: c.name }));
  if (typed && !categoryOptions.some((o) => looseKey(o.label) === looseKey(typed))) categoryOptions.push({ value: `${NEW_CATEGORY}${typed}`, label: `Add new category “${typed}”` });
  const cardType = mode?.code === 'DEBIT_CARD' ? 'DEBIT_CARD' : mode?.code === 'CREDIT_CARD' ? 'CREDIT_CARD' : undefined;
  const cardCount = (cardAccounts.data ?? []).filter((c) => c.isActive && c.legalEntityId === legalEntityId && c.type === mode?.code).length;

  const add = trpc.purchases.addEntry.useMutation({ onError: (e) => message.error(e.message) });
  const saving = add.isPending || uploading;

  const submit = async (v: Values) => {
    const category = v.category ?? '';
    const entry: PurchaseEntryInput = {
      date: v.date,
      details: v.details,
      vendorId: v.vendorId,
      legalEntityId: v.legalEntityId,
      projectId: v.projectId || undefined,
      expenseCategoryId: category && !category.startsWith(NEW_CATEGORY) ? category : undefined,
      categoryName: category.startsWith(NEW_CATEGORY) ? category.slice(NEW_CATEGORY.length) : undefined,
      amount: v.amount,
      otherCharges: v.otherCharges || undefined,
      totalAmount: v.totalAmount,
      gstSplit: v.gstSplit && v.gstSplit !== 'AUTO' ? v.gstSplit : undefined,
      billNumber: v.billNumber?.trim() || undefined,
      paidBy: v.paidBy?.trim() || undefined,
      invoiceLink: v.invoiceLink?.trim() || undefined,
      paymentReceiptLink: v.paymentReceiptLink?.trim() || undefined,
      paymentModeId: v.paymentModeId || undefined,
      cardAccountId: v.paymentModeId && mode?.requiresCardSource ? v.cardAccountId : undefined,
      bankAccountId: v.paymentModeId && !mode?.requiresCardSource ? v.bankAccountId : undefined,
    };
    const saved = await add.mutateAsync({ entry, idempotencyKey: key }).catch(() => null);
    if (!saved) return;
    if (entry.paymentModeId) rememberSource(v.legalEntityId, { paymentModeId: entry.paymentModeId, bankAccountId: entry.bankAccountId, cardAccountId: entry.cardAccountId });
    const text = `${saved.paid ? 'Bill posted and paid' : 'Bill posted; it waits in To pay'}${saved.categoryCreated ? ', and the new category added to Masters' : ''}.`;
    if (file) {
      setUploading(true);
      try {
        await uploadAndLink(file, 'VENDOR_BILL', saved.vendorBillId);
      } catch (error) {
        message.warning(`${text} The invoice file did not upload (${error instanceof Error ? error.message : 'unknown error'}); add it under Documents on the bill.`);
        setUploading(false);
        router.push(`/vendor-bills/${saved.vendorBillId}`);
        return;
      }
      setUploading(false);
    }
    message.success(text);
    await utils.purchases.list.invalidate();
    router.push('/purchases');
  };

  return (
    <UiCard>
      <Form<Values>
        form={form}
        layout="vertical"
        requiredMark
        onFinish={submit}
        initialValues={{ date: new Date().toISOString().slice(0, 10), gstSplit: 'AUTO' }}
        onValuesChange={(changed: Partial<Values>) => {
          // A company's last-used mode and account come back, as in the Pay dialog.
          if (changed.legalEntityId && canPay) form.setFieldsValue({ paymentModeId: undefined, bankAccountId: undefined, cardAccountId: undefined, projectId: undefined, ...rememberedSource(changed.legalEntityId) });
          else if (changed.legalEntityId) form.setFieldsValue({ projectId: undefined });
        }}
      >
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-[200px_1fr]">
          <Form.Item label="Date" name="date" rules={[{ required: true, message: 'Date is required.' }]}>
            <DateInput />
          </Form.Item>
          <Form.Item label="Details" name="details" rules={[{ required: true, whitespace: true, message: 'Details are required.' }, { max: 2000 }]}>
            <Input.TextArea rows={1} autoSize={{ minRows: 1, maxRows: 4 }} placeholder="e.g. MS Brackets with Screw for Aluminium Enclosure - 15 Set" />
          </Form.Item>
        </div>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
          <Form.Item label="Supplier" name="vendorId" rules={[{ required: true, message: 'Supplier is required.' }]} extra="F2 adds a new supplier.">
            <VendorSelect placeholder="Select supplier…" />
          </Form.Item>
          <Form.Item label="Company" name="legalEntityId" rules={[{ required: true, message: 'Company is required.' }]}>
            <LegalEntitySelect placeholder="Legal entity" />
          </Form.Item>
          <Form.Item label="Category" name="category" extra="Blank is Office / Administrative. A new name is added to Masters.">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Office / Administrative"
              loading={categories.isLoading}
              onSearch={setCategorySearch}
              onChange={() => setCategorySearch('')}
              options={categoryOptions}
            />
          </Form.Item>
          <Form.Item label="Project (optional)" name="projectId" extra="Blank is company overhead.">
            <ProjectSelect legalEntityId={legalEntityId} allowClear placeholder="Company overhead" />
          </Form.Item>
        </div>

        <Section>Amount, as on the bill</Section>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
          <Form.Item label="Amount" name="amount" rules={[{ required: true, message: 'Amount is required.' }]} extra="Before GST.">
            <MoneyInput placeholder="0.00" />
          </Form.Item>
          <Form.Item label="Other Charges" name="otherCharges" extra="Added to the amount; blank for none.">
            <MoneyInput placeholder="0.00" />
          </Form.Item>
          <Form.Item label="Amount With GST" name="totalAmount" rules={[{ required: true, message: 'Amount With GST is required.' }]} extra="What was paid; GST is the difference.">
            <MoneyInput placeholder="0.00" />
          </Form.Item>
          <Form.Item label="GST type" name="gstSplit">
            <Select
              options={[
                { value: 'AUTO', label: 'By supplier’s state' },
                { value: 'CGST_SGST', label: 'CGST + SGST' },
                { value: 'IGST', label: 'IGST' },
              ]}
            />
          </Form.Item>
        </div>

        <Section>Paid</Section>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 xl:grid-cols-4">
          <Form.Item label="Paid by" name="paidBy" extra="Who paid; added to the details.">
            <Input placeholder="e.g. Hemdeep" />
          </Form.Item>
          {canPay ? (
            <>
              <Form.Item label="Payment Mode" name="paymentModeId" extra="Blank: not paid yet; the bill waits in To pay.">
                <Select
                  allowClear
                  placeholder="Not paid yet"
                  loading={paymentModes.isLoading}
                  onChange={() => form.setFieldsValue({ cardAccountId: undefined, bankAccountId: undefined })}
                  options={(paymentModes.data ?? []).map((m) => ({ value: m.id, label: m.label }))}
                />
              </Form.Item>
              {paymentModeId ? (
                mode?.requiresCardSource ? (
                  <Form.Item
                    label={mode.code === 'DEBIT_CARD' ? 'Card no (debit card)' : 'Card no (credit card)'}
                    name="cardAccountId"
                    rules={[{ required: true, message: 'Card is required.' }]}
                    extra={legalEntityId && cardAccounts.data && cardCount === 0 ? 'No card of this type for this company in Card Accounts.' : undefined}
                  >
                    <CardAccountSelect legalEntityId={legalEntityId} cardType={cardType} disabled={!legalEntityId} placeholder={legalEntityId ? 'Select card…' : 'Choose the company first'} />
                  </Form.Item>
                ) : (
                  <Form.Item label="Account no" name="bankAccountId" rules={[{ required: true, message: 'Bank account is required.' }]}>
                    <BankAccountSelect legalEntityId={legalEntityId} disabled={!legalEntityId} placeholder={legalEntityId ? 'Select account…' : 'Choose the company first'} />
                  </Form.Item>
                )
              ) : null}
            </>
          ) : null}
          <Form.Item label="Bill no (optional)" name="billNumber" extra="Blank: one is made from the row.">
            <Input placeholder="Supplier's invoice no." />
          </Form.Item>
        </div>

        <Section>Links</Section>
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-3">
          <Form.Item label="Invoice Link (optional)" name="invoiceLink" rules={[{ pattern: /^https?:\/\/\S+$/i, message: 'A web address starting with https://.' }]}>
            <Input placeholder="https://drive.google.com/…" inputMode="url" />
          </Form.Item>
          {canAttach ? (
            <Form.Item label="Invoice file (optional)" extra="PDF or image. More files can be added on the bill later.">
              <Upload
                maxCount={1}
                beforeUpload={(chosen) => {
                  setFile(chosen);
                  return false;
                }}
                onRemove={() => setFile(null)}
                fileList={file ? [{ uid: '-1', name: file.name, size: file.size }] : []}
              >
                <Button>Choose file</Button>
              </Upload>
            </Form.Item>
          ) : null}
          <Form.Item label="Payment Receipt (optional)" name="paymentReceiptLink" rules={[{ pattern: /^https?:\/\/\S+$/i, message: 'A web address starting with https://.' }]}>
            <Input placeholder="https://drive.google.com/…" inputMode="url" />
          </Form.Item>
        </div>

        <div className="flex gap-[10px]">
          <Button type="primary" htmlType="submit" loading={saving}>
            Post bill
          </Button>
          <Button onClick={() => router.push('/purchases')} disabled={saving}>
            Cancel
          </Button>
        </div>
      </Form>
    </UiCard>
  );
}
