'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Input, Modal, Select, Tabs } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, MoneyText, PageHeader, UiCard } from '@zitaware/ui';
import type { PurchaseRow, PurchaseStage } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { newIdempotencyKey } from '../vendor-bills/shared';
import { PayModal } from './pay-modal';
import { ImportPurchasesModal } from './import-modal';

const PAGE_SIZE = 25;

const STAGE_LABEL: Record<PurchaseStage, string> = {
  DRAFT: 'Draft',
  WAITING_APPROVAL: 'Waiting approval',
  TO_PAY: 'To pay',
  PART_PAID: 'Part paid',
  PAID: 'Paid',
  CLOSED: 'Rejected / void',
};
const STAGES = Object.keys(STAGE_LABEL) as PurchaseStage[];

/**
 * Purchases (ADR-176): every vendor bill from entry to payment on one
 * screen, by stage. Approve, reject and pay from the row; a bill's own page
 * holds its lines, documents and payments.
 */
export default function PurchasesPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery().data;
  const permissions = me?.permissions ?? [];
  const canCreate = permissions.includes('vendor_bill.create');
  const canApprove = permissions.includes('vendor_bill.approve');
  const canPay = permissions.includes('vendor_payment.post');

  const [stage, setStage] = useState<PurchaseStage>('TO_PAY');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PurchaseRow[]>([]);
  const [paying, setPaying] = useState<PurchaseRow[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deciding, setDeciding] = useState<{ bill: PurchaseRow; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');
  const [decisionKey, setDecisionKey] = useState(newIdempotencyKey);

  const list = trpc.purchases.list.useQuery({ stage, search: search.trim() || undefined, projectId, page, pageSize: PAGE_SIZE });
  const projects = trpc.projects.list.useQuery();
  const refresh = async () => {
    setSelected([]);
    await utils.purchases.list.invalidate();
  };
  const afterDecision = async (text: string) => {
    message.success(text);
    setDeciding(null);
    setNote('');
    setDecisionKey(newIdempotencyKey());
    await refresh();
  };
  const approve = trpc.vendorBills.approve.useMutation({ onSuccess: () => afterDecision('Bill approved.'), onError: (e) => message.error(e.message) });
  const reject = trpc.vendorBills.reject.useMutation({ onSuccess: () => afterDecision('Bill rejected.'), onError: (e) => message.error(e.message) });

  const counts = list.data?.counts;
  const payable = stage === 'TO_PAY' || stage === 'PART_PAID';
  const sameVendor = selected.length > 0 && selected.every((r) => r.vendorId === selected[0]!.vendorId && r.legalEntityId === selected[0]!.legalEntityId);

  const columns: ColumnsType<PurchaseRow> = [
    {
      title: 'Vendor',
      key: 'vendor',
      render: (_v, r) => (
        <div>
          <div className="font-semibold text-ink">{r.vendorName}</div>
          <div className="text-[11.5px] text-muted">{r.legalEntityName}</div>
        </div>
      ),
    },
    {
      title: 'Bill',
      key: 'bill',
      render: (_v, r) => (
        <div>
          <div className="text-ink">{r.vendorBillNumber}</div>
          <div className="text-[11.5px] text-muted">{formatDate(r.vendorBillDate)}</div>
        </div>
      ),
    },
    { title: 'Project', dataIndex: 'projectName', key: 'project', render: (v: string | null) => v ?? 'Company overhead' },
    { title: 'Total', key: 'total', align: 'right', render: (_v, r) => <span className="whitespace-nowrap tabular-nums">{formatMoney(r.totalAmount)}</span> },
    ...(stage === 'PART_PAID' || stage === 'PAID'
      ? [{ title: 'Paid', key: 'paid', align: 'right' as const, render: (_v: unknown, r: PurchaseRow) => <MoneyText tone="positive">{formatMoney(r.paidAmount)}</MoneyText> }]
      : []),
    ...(payable ? [{ title: 'Left to pay', key: 'due', align: 'right' as const, render: (_v: unknown, r: PurchaseRow) => <MoneyText tone="negative">{formatMoney(r.dueAmount)}</MoneyText> }] : []),
    { title: 'Stage', key: 'stage', render: (_v, r) => <span className="text-[12.5px] text-muted">{r.stage === 'CLOSED' ? r.status.toLowerCase() : STAGE_LABEL[r.stage]}</span> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_v, r) => (
        <div className="flex justify-end gap-2">
          {r.stage === 'WAITING_APPROVAL' && canApprove ? (
            <>
              <Button size="small" type="primary" onClick={() => setDeciding({ bill: r, action: 'approve' })}>
                Approve
              </Button>
              <Button size="small" danger onClick={() => setDeciding({ bill: r, action: 'reject' })}>
                Reject
              </Button>
            </>
          ) : null}
          {(r.stage === 'TO_PAY' || r.stage === 'PART_PAID') && canPay ? (
            <Button size="small" type="primary" onClick={() => setPaying([r])}>
              Pay
            </Button>
          ) : null}
          <Button size="small" onClick={() => router.push(`/vendor-bills/${r.vendorBillId}`)}>
            {r.stage === 'DRAFT' ? 'Open' : 'View'}
          </Button>
        </div>
      ),
    },
  ];

  const ownBill = deciding && deciding.bill.createdBy === me?.userId;
  return (
    <>
      <PageHeader
        title="Purchases"
        description="Every vendor bill from entry to payment. Enter or import bills, approve them, and pay them from here."
        actions={
          <div className="flex gap-2">
            {canApprove ? <Button onClick={() => setImportOpen(true)}>Import Excel</Button> : null}
            {canCreate || canApprove ? (
              // Approvers enter a bill as a register row (ADR-181); others draft one for approval.
              <Button type="primary" onClick={() => router.push(canApprove ? '/purchases/new' : '/vendor-bills/new')}>
                Add bill
              </Button>
            ) : null}
          </div>
        }
      />

      <UiCard flush>
        <div className="px-4 pt-2">
          <Tabs
            activeKey={stage}
            onChange={(k) => {
              setStage(k as PurchaseStage);
              setPage(1);
              setSelected([]);
            }}
            items={STAGES.map((s) => ({ key: s, label: `${STAGE_LABEL[s]}${counts ? ` (${counts[s]})` : ''}` }))}
          />
        </div>
        <FilterCard
          actions={
            payable && canPay ? (
              <Button type="primary" disabled={!sameVendor} onClick={() => setPaying(selected)} title={selected.length > 0 && !sameVendor ? 'Select bills of one vendor and legal entity' : undefined}>
                Pay selected{selected.length ? ` (${selected.length})` : ''}
              </Button>
            ) : undefined
          }
        >
          <FilterField label="Search">
            <Input
              allowClear
              placeholder="Vendor or bill no…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-[240px]"
            />
          </FilterField>
          <FilterField label="Project">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All"
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setPage(1);
              }}
              className="w-[220px]"
              options={[...(projects.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }))}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<PurchaseRow>
          rowKey="vendorBillId"
          columns={columns}
          dataSource={list.data?.rows ?? []}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load purchases. Please retry.' : undefined}
          emptyTitle={`Nothing in "${STAGE_LABEL[stage]}"`}
          {...(payable && canPay
            ? { rowSelection: { selectedRowKeys: selected.map((r) => r.vendorBillId), onChange: (_keys: React.Key[], rows: PurchaseRow[]) => setSelected(rows) } }
            : {})}
          page={page}
          pageSize={PAGE_SIZE}
          total={list.data?.total ?? 0}
          onPageChange={setPage}
        />
      </UiCard>

      {paying ? <PayModal key={paying.map((p) => p.vendorBillId).join(',')} bills={paying} onClose={() => setPaying(null)} onPaid={refresh} /> : null}
      <ImportPurchasesModal open={importOpen} onClose={() => setImportOpen(false)} onImported={refresh} />

      <Modal
        open={!!deciding}
        title={deciding?.action === 'approve' ? 'Approve bill' : 'Reject bill'}
        okText={deciding?.action === 'approve' ? 'Approve' : 'Reject'}
        okButtonProps={{ danger: deciding?.action === 'reject', disabled: (deciding?.action === 'reject' || !!ownBill) && !note.trim() }}
        confirmLoading={approve.isPending || reject.isPending}
        onCancel={() => {
          setDeciding(null);
          setNote('');
        }}
        onOk={() => {
          if (!deciding) return;
          const base = { id: deciding.bill.vendorBillId, expectedVersion: deciding.bill.version, idempotencyKey: decisionKey };
          if (deciding.action === 'approve') approve.mutate({ ...base, note: note.trim() || undefined });
          else reject.mutate({ ...base, reason: note.trim() });
        }}
        destroyOnHidden
      >
        {deciding ? (
          <p className="mt-0 text-[13px] text-muted">
            {deciding.bill.vendorName} · bill {deciding.bill.vendorBillNumber} · {formatMoney(deciding.bill.totalAmount)} · {deciding.bill.projectName}
            {deciding.action === 'approve' ? '. Approving posts it to the books: the cost on the project and the amount owed to the vendor.' : '.'}
          </p>
        ) : null}
        <Input.TextArea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={deciding?.action === 'reject' ? 'Why (required)' : ownBill ? 'You entered this bill: say why you approve it yourself (required)' : 'Note (optional)'}
        />
      </Modal>
    </>
  );
}
