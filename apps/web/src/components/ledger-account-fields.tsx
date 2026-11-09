'use client';

import { App, Collapse, Form, Input, Modal, Select, Switch } from 'antd';
import { trpc } from '@/server/trpc';
import type { QuickAddBoxProps } from '@/components/quick-add-select';

export interface LedgerAccountFormValues {
  code: string;
  name: string;
  description: string | undefined;
  accountGroupId: string;
  allowManualPosting: boolean;
}

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

/** "Name (CODE)", as every ledger account picker shows it. */
export function ledgerAccountLabel(account: { code: string; name: string }): string {
  return `${account.name} (${account.code})`;
}

/**
 * The ledger account form's fields, inside a `Form<LedgerAccountFormValues>`.
 * The Chart of Accounts page and the F2 box both render these, so they always
 * match. Only active groups are offered. In edit mode the code is locked.
 */
export function LedgerAccountFields({ mode, autoFocus }: { mode: 'create' | 'edit'; autoFocus?: boolean }) {
  const form = Form.useFormInstance<LedgerAccountFormValues>();
  // The same query the Chart of Accounts page makes, so it is fetched once.
  const groups = trpc.chartOfAccounts.listGroups.useQuery({ includeInactive: true });
  const activeGroupOptions = (groups.data ?? []).filter((row) => row.isActive).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }));

  return (
    <>
      <Form.Item label="Account Code" name="code" rules={[{ required: true, message: 'Account code is required.' }, { max: 50 }]}>
        <Input disabled={mode === 'edit'} onBlur={(e) => form.setFieldValue('code', normalizeCode(e.target.value))} placeholder="e.g. BANK" />
      </Form.Item>
      <Form.Item label="Account Name" name="name" rules={[{ required: true, message: 'Account name is required.' }, { max: 200 }]}>
        <Input {...(autoFocus ? { autoFocus: true } : {})} />
      </Form.Item>
      <Form.Item label="Account Group" name="accountGroupId" rules={[{ required: true, message: 'An account group is required.' }]}>
        <Select showSearch optionFilterProp="label" placeholder="Select an account group" loading={groups.isLoading} options={activeGroupOptions} />
      </Form.Item>
      <Form.Item label="Description" name="description" rules={[{ max: 2000 }]}>
        <Input.TextArea rows={3} />
      </Form.Item>
      <Collapse
        className="mb-4"
        items={[
          {
            key: 'advanced',
            label: 'Advanced settings',
            children: (
              <Form.Item
                label="Allow manual posting"
                name="allowManualPosting"
                valuePropName="checked"
                extra="When on, this account can receive hand-entered journal entries once posting is available. Most accounts should stay on."
              >
                <Switch />
              </Form.Item>
            ),
          },
        ]}
      />
    </>
  );
}

/** What `chartOfAccounts.createAccount` is sent, from the page and the F2 box alike. */
export function ledgerAccountCreateInput(values: LedgerAccountFormValues) {
  return {
    code: normalizeCode(values.code),
    name: values.name,
    description: values.description,
    accountGroupId: values.accountGroupId,
    allowManualPosting: values.allowManualPosting,
  };
}

const ADD_FORM_ID = 'ledger-account-quick-add';

/** Mounted afresh each time the box opens (the box is destroyed when hidden), so nothing is left from the last one. */
function LedgerAccountAddForm({ initialText, onSubmit }: { initialText: string; onSubmit: (values: LedgerAccountFormValues) => void }) {
  const [form] = Form.useForm<LedgerAccountFormValues>();
  return (
    <Form<LedgerAccountFormValues>
      form={form}
      name={ADD_FORM_ID}
      layout="vertical"
      requiredMark
      initialValues={{ name: initialText, allowManualPosting: true }}
      onFinish={onSubmit}
    >
      <LedgerAccountFields mode="create" autoFocus />
    </Form>
  );
}

/** The F2 box of the ledger account picker: the full Add Ledger Account form, with what was typed as the name. */
export function LedgerAccountAddBox({ open, initialText, onClose, onCreated }: QuickAddBoxProps) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const create = trpc.chartOfAccounts.createAccount.useMutation({
    onSuccess: async (created) => {
      message.success('Ledger account created.');
      onCreated({ value: created.id, label: ledgerAccountLabel(created) });
      await utils.chartOfAccounts.listAccounts.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Modal
      open={open}
      width={480}
      title="Add ledger account"
      okText="Add ledger account"
      okButtonProps={{ htmlType: 'submit', form: ADD_FORM_ID }}
      confirmLoading={create.isPending}
      onCancel={onClose}
      destroyOnHidden
    >
      <LedgerAccountAddForm initialText={initialText} onSubmit={(values) => create.mutate(ledgerAccountCreateInput(values))} />
    </Modal>
  );
}
