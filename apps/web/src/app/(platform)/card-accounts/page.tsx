'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Drawer, Form, Input, Modal, Popconfirm, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MoneyInput, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DraftFormNote, useFormDraft } from '@/components/form-draft';
import { formatMoney } from '@/lib/format';
import { DateInput } from '@/components/date-input';
import { BankAccountSelect } from '@/components/bank-account-select';
import { CardAccountFields, cardAccountCreateInput, groupCardNumber, lastFourOf, type CardAccountFormValues, type CardType } from '@/components/card-account-fields';

interface CardAccountRow {
  id: string;
  legalEntityId: string;
  type: CardType;
  displayName: string;
  issuerName: string | null;
  maskedLastFour: string;
  cardNumber: string | null;
  cardholderEmployeeId: string | null;
  cardholderEmployeeName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  ledgerAccountId: string | null;
  ledgerAccountName: string | null;
  statementDay: number | null;
  paymentDueDay: number | null;
  isActive: boolean;
  version: number;
}

type FormValues = CardAccountFormValues;

interface SettleFormValues {
  amount: string;
  settlementDate: string;
  bankAccountId: string;
  transactionReference?: string;
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

const PAGE_SIZE = 25;

export default function CardAccountsPage() {
  const { message } = App.useApp();
  const me = trpc.auth.me.useQuery();
  const canManage = (me.data?.permissions ?? []).includes('legal_entity.manage');
  const canSettle = (me.data?.permissions ?? []).includes('card_account.settle');

  const utils = trpc.useUtils();
  const list = trpc.legalEntities.listCardAccounts.useQuery({ includeInactive: true });
  const legalEntities = trpc.legalEntities.list.useQuery();
  const legalEntityNameById = useMemo(() => new Map((legalEntities.data ?? []).map((e) => [e.id, e.legalName])), [legalEntities.data]);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CardType | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CardAccountRow | null>(null);
  const [form] = Form.useForm<FormValues>();
  const formKey = editing ? `card-account:${editing.id}` : 'card-account:new';
  const formDraft = useFormDraft(drawerOpen ? formKey : 'card-account:closed');
  const clearDraft = trpc.formDrafts.clear.useMutation();
  const appliedDraft = useRef('');
  useEffect(() => {
    const token = `${drawerOpen}:${formKey}`;
    if (!drawerOpen || formDraft.isLoading || appliedDraft.current === token) return;
    appliedDraft.current = token;
    if (formDraft.payload) form.setFieldsValue(formDraft.payload as unknown as FormValues);
  }, [drawerOpen, formKey, formDraft.isLoading, formDraft.payload, form]);

  const filtered = useMemo(() => {
    const rows = (list.data ?? []) as CardAccountRow[];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter && row.type !== typeFilter) return false;
      if (!q) return true;
      return row.displayName.toLowerCase().includes(q) || (row.issuerName ?? '').toLowerCase().includes(q) || row.maskedLastFour.includes(q);
    });
  }, [list.data, search, typeFilter]);

  const invalidate = async () => utils.legalEntities.listCardAccounts.invalidate();

  const createMutation = trpc.legalEntities.createCardAccount.useMutation({
    onSuccess: async () => {
      message.success('Card account added.');
      setDrawerOpen(false);
      clearDraft.mutate({ formKey: 'card-account:new' });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const updateMutation = trpc.legalEntities.updateCardAccount.useMutation({
    onSuccess: async () => {
      message.success('Card account updated.');
      setDrawerOpen(false);
      if (editing) clearDraft.mutate({ formKey: `card-account:${editing.id}` });
      await invalidate();
    },
    onError: (error) => message.error(error.message),
  });
  const setActiveMutation = trpc.legalEntities.setCardAccountActive.useMutation({
    onSuccess: async () => await invalidate(),
    onError: (error) => message.error(error.message),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  };
  const openEdit = (row: CardAccountRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      legalEntityId: row.legalEntityId,
      type: row.type,
      displayName: row.displayName,
      ...(row.cardNumber ? { cardNumber: groupCardNumber(row.cardNumber) } : {}),
      ...(row.issuerName != null ? { issuerName: row.issuerName } : {}),
      ...(row.cardholderEmployeeId != null ? { cardholderEmployeeId: row.cardholderEmployeeId } : {}),
      ...(row.bankAccountId != null ? { bankAccountId: row.bankAccountId } : {}),
      ...(row.statementDay != null ? { statementDay: row.statementDay } : {}),
      ...(row.paymentDueDay != null ? { paymentDueDay: row.paymentDueDay } : {}),
    });
    setDrawerOpen(true);
  };
  const onFinish = (values: FormValues) => {
    if (editing) {
      const digits = values.cardNumber ? values.cardNumber.replace(/\D/g, '') : undefined;
      updateMutation.mutate({
        id: editing.id,
        displayName: values.displayName,
        issuerName: values.issuerName?.trim() || null,
        cardNumber: digits || undefined,
        maskedLastFour: (digits ? digits.slice(-4) : undefined) ?? editing.maskedLastFour,
        cardholderEmployeeId: values.cardholderEmployeeId || null,
        statementDay: values.statementDay ?? null,
        paymentDueDay: values.paymentDueDay ?? null,
        expectedVersion: editing.version,
      });
    } else {
      createMutation.mutate(cardAccountCreateInput(values));
    }
  };

  const [settleTarget, setSettleTarget] = useState<CardAccountRow | null>(null);
  const [settleKey, setSettleKey] = useState(newIdempotencyKey());
  const [settleForm] = Form.useForm<SettleFormValues>();
  const outstanding = trpc.cardSettlements.getOutstandingBalance.useQuery({ cardAccountId: settleTarget?.id ?? '' }, { enabled: !!settleTarget });

  const settleMutation = trpc.cardSettlements.settleCreditCard.useMutation({
    onSuccess: async () => {
      message.success('Credit card settled.');
      setSettleTarget(null);
      setSettleKey(newIdempotencyKey());
      await utils.cardSettlements.getOutstandingBalance.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const openSettle = (row: CardAccountRow) => {
    settleForm.resetFields();
    settleForm.setFieldsValue({ settlementDate: new Date().toISOString().slice(0, 10) });
    setSettleTarget(row);
  };
  const submitSettle = (values: SettleFormValues) => {
    if (!settleTarget) return;
    settleMutation.mutate({
      cardAccountId: settleTarget.id,
      amount: values.amount,
      settlementDate: values.settlementDate,
      bankAccountId: values.bankAccountId,
      transactionReference: values.transactionReference?.trim() || undefined,
      idempotencyKey: settleKey,
    });
  };

  const columns: ColumnsType<CardAccountRow> = [
    {
      title: 'Card',
      key: 'displayName',
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-ink">
            {row.displayName} · {row.cardNumber ? groupCardNumber(row.cardNumber) : `•••• ${row.maskedLastFour}`}
          </div>
          <div className="text-[11.5px] text-muted">{row.issuerName ?? '—'}</div>
        </div>
      ),
    },
    { title: 'Type', key: 'type', render: (_v, row) => (row.type === 'DEBIT_CARD' ? 'Debit Card' : 'Credit Card') },
    { title: 'Cardholder', key: 'cardholder', render: (_v, row) => row.cardholderEmployeeName ?? '—' },
    { title: 'Linked account', key: 'linked', render: (_v, row) => (row.type === 'DEBIT_CARD' ? row.bankAccountName : row.ledgerAccountName) ?? '—' },
    { title: 'Legal Entity', key: 'legalEntity', render: (_v, row) => legalEntityNameById.get(row.legalEntityId) ?? '—' },
    { title: 'Status', dataIndex: 'isActive', key: 'isActive', width: 110, render: (v: boolean) => <StatusTag status={v ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      title: '',
      key: 'actions',
      width: 260,
      align: 'right',
      render: (_v, row) => (
        <div className="flex justify-end gap-2">
          {canSettle && row.type === 'CREDIT_CARD' && row.isActive ? (
            <Button size="small" onClick={() => openSettle(row)}>
              Settle…
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button size="small" onClick={() => openEdit(row)}>
                Edit
              </Button>
              <Popconfirm
                title={row.isActive ? 'Deactivate this card?' : 'Reactivate this card?'}
                onConfirm={() => setActiveMutation.mutate({ id: row.id, isActive: !row.isActive, expectedVersion: row.version })}
              >
                <Button size="small" danger={row.isActive}>
                  {row.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </Popconfirm>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Card Accounts"
        description="Debit and credit cards Direct Expense payments can be recorded against. A debit card reduces its linked bank account immediately; a credit card posts to its own payable ledger until settled."
        actions={
          canManage ? (
            <Button type="primary" onClick={openCreate}>
              Add Card
            </Button>
          ) : undefined
        }
      />

      <UiCard flush>
        <FilterCard>
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Search cards…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[240px]"
            />
          </FilterField>
          <FilterField label="Type">
            <Select
              allowClear
              placeholder="All"
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
              className="w-[180px]"
              options={[
                { value: 'DEBIT_CARD', label: 'Debit Card' },
                { value: 'CREDIT_CARD', label: 'Credit Card' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<CardAccountRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load card accounts. Please retry.' : undefined}
          emptyTitle="No card accounts found"
          emptyDescription={canManage ? 'Use "Add Card" to add one.' : undefined}
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <Drawer open={drawerOpen} title={editing ? 'Edit Card Account' : 'Add Card Account'} onClose={() => setDrawerOpen(false)} width={480} destroyOnHidden>
        <Form<FormValues> form={form} layout="vertical" requiredMark onFinish={onFinish} initialValues={{ type: 'DEBIT_CARD' }}>
          <CardAccountFields lockLegalEntity={!!editing} editing={editing} />

          <Form.Item className="mb-0 mt-2">
            <div className="flex justify-end gap-[10px]">
              <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
              {formDraft.payload ? <DraftFormNote saveLabel="Save" /> : null}
              <Button
                htmlType="button"
                loading={formDraft.saving}
                onClick={() => {
                  // A draft is stored on the server, so it never carries the card number.
                  const draft: Partial<FormValues> = { ...(form.getFieldsValue(true) as FormValues) };
                  delete draft.cardNumber;
                  formDraft.save(draft as unknown as Record<string, unknown>);
                }}
              >
                Save as draft
              </Button>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending || updateMutation.isPending}>
                {editing ? 'Save changes' : 'Save'}
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Drawer>

      <Modal title="Settle Credit Card" open={!!settleTarget} onCancel={() => setSettleTarget(null)} footer={null} destroyOnHidden>
        {settleTarget ? (
          <>
            <p className="mb-3 text-muted">
              {settleTarget.displayName} · {settleTarget.cardNumber ? groupCardNumber(settleTarget.cardNumber) : `•••• ${settleTarget.maskedLastFour}`} — outstanding balance:{' '}
              <span className="font-semibold text-ink">{outstanding.data ? formatMoney(outstanding.data.outstandingBalance) : '…'}</span>
            </p>
            <Form<SettleFormValues> form={settleForm} layout="vertical" onFinish={submitSettle}>
              <Form.Item label="Amount" name="amount" rules={[{ required: true, message: 'Amount is required.' }]}>
                <MoneyInput placeholder="0.00" />
              </Form.Item>
              <Form.Item label="Settlement date" name="settlementDate" rules={[{ required: true, message: 'Settlement date is required.' }]}>
                <DateInput />
              </Form.Item>
              <Form.Item label="Paying bank account" name="bankAccountId" rules={[{ required: true, message: 'Bank account is required.' }]}>
                <BankAccountSelect legalEntityId={settleTarget.legalEntityId} />
              </Form.Item>
              <Form.Item label="Transaction reference (optional)" name="transactionReference">
                <Input placeholder="UTR / reference number" />
              </Form.Item>
              <Form.Item className="mb-0 mt-2">
                <div className="flex justify-end gap-[10px]">
                  <Button onClick={() => setSettleTarget(null)}>Cancel</Button>
                  <Button type="primary" htmlType="submit" loading={settleMutation.isPending}>
                    Settle
                  </Button>
                </div>
              </Form.Item>
            </Form>
          </>
        ) : null}
      </Modal>
    </>
  );
}
