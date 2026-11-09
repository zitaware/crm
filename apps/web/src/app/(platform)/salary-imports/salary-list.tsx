'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { App, Button, Drawer, Form, Input, InputNumber, Modal, Select, Table } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, FilterField, KpiCard, MoneyText, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import { NextStep } from '@/components/next-step';
import { BankAccountSelect } from '@/components/bank-account-select';
import {
  formatSalaryMonth,
  newIdempotencyKey,
  SalaryImportStatusTag,
  SalaryPaymentStatusTag,
  type SalaryImportRow,
} from './shared';
import { isoDate } from '@/lib/dates';

const PAGE_SIZE = 25;

/** One employee's row in the pay form. */
interface PayRow {
  employeeId: string;
  paidAmount: number;
  tdsAmount: number;
  referenceNumber?: string | undefined;
}

interface PayFormValues {
  bankAccountId: string;
  paymentDate: string;
  referenceNumber?: string | undefined;
  rows: PayRow[];
}

export function SalaryImportsScreen() {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [legalEntityFilter, setLegalEntityFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<SalaryImportRow['status'] | undefined>(undefined);
  const [reversing, setReversing] = useState<SalaryImportRow | null>(null);
  const [paying, setPaying] = useState<SalaryImportRow | null>(null);
  // A committed batch's rows were previously unviewable — `preview` only
  // runs before commit, so once posted the detail was unreachable (ADR-097).
  const [viewing, setViewing] = useState<SalaryImportRow | null>(null);
  const [reverseForm] = Form.useForm<{ reason: string; accountingDate: string }>();

  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreate = permissions.includes('salary_import.create');
  const canCommit = permissions.includes('salary_import.commit');
  const canPay = permissions.includes('salary_import.pay');

  const legalEntities = trpc.legalEntities.list.useQuery();
  const list = trpc.salaryImports.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    legalEntityId: legalEntityFilter,
    status: statusFilter,
  });
  const rows = (list.data?.rows ?? []) as SalaryImportRow[];

  const reverseMutation = trpc.salaryImports.reverse.useMutation({
    onSuccess: () => {
      message.success('Salary import reversed.');
      setReversing(null);
      reverseForm.resetFields();
      void utils.salaryImports.list.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  const columns: ColumnsType<SalaryImportRow> = [
    {
      title: 'Month',
      dataIndex: 'salaryMonth',
      key: 'salaryMonth',
      render: (v: string, row) => (
        <button type="button" className="text-left font-semibold text-ink hover:text-brand" onClick={() => setViewing(row)}>
          {formatSalaryMonth(v)}
        </button>
      ),
    },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', key: 'legalEntityName' },
    { title: 'Posted On', dataIndex: 'accountingDate', key: 'accountingDate', render: (v: string) => formatDate(v) },
    { title: 'Employees', dataIndex: 'employeeCount', key: 'employeeCount', align: 'right' },
    {
      title: 'Gross Salary',
      dataIndex: 'totalGrossAmount',
      key: 'totalGrossAmount',
      align: 'right',
      render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText>,
    },
    {
      title: 'Outstanding',
      dataIndex: 'outstandingAmount',
      key: 'outstandingAmount',
      align: 'right',
      // Only a posted month carries a live liability; the server returns
      // '0.00' for the others, and a dash says "nothing owed" more clearly
      // than a zero that could be mistaken for "settled".
      render: (v: string, row) =>
        row.status !== 'POSTED' ? (
          <span className="text-muted">—</span>
        ) : Number(v) === 0 ? (
          <span className="text-[12px] font-semibold text-positive">Settled</span>
        ) : (
          <MoneyText tone="negative">{formatMoney(v)}</MoneyText>
        ),
    },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (v: SalaryImportRow['status']) => <SalaryImportStatusTag status={v} /> },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_: unknown, row) => (
        <div className="flex justify-end gap-2">
          {/* Only a posted month has a journal. A DRAFT's journalEntryId is
              null, and linking to it produced /journal-entries/null. */}
          {row.journalEntryId ? (
            <Button size="small" onClick={() => router.push(`/journal-entries/${row.journalEntryId}`)}>
              Journal
            </Button>
          ) : null}
          {canCreate && row.status === 'DRAFT' ? (
            <Button size="small" type="primary" onClick={() => router.push(`/employee-costing/new?draftId=${row.id}`)}>
              Review &amp; Commit
            </Button>
          ) : null}
          {canPay && row.status === 'POSTED' && Number(row.outstandingAmount) > 0 ? (
            <Button size="small" type="primary" onClick={() => setPaying(row)}>
              Pay
            </Button>
          ) : null}
          {canCommit && row.status === 'POSTED' ? (
            <Button size="small" danger onClick={() => setReversing(row)}>
              Reverse
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="m-0 text-[12.5px] text-muted">One posted salary per legal entity per month. This is what the month cost.</p>
        {canCreate ? (
          <Button type="primary" onClick={() => router.push('/employee-costing/new')}>
            Import month
          </Button>
        ) : null}
      </div>

      <UiCard flush>
        <FilterCard
          actions={
            <Button
              onClick={() => {
                setLegalEntityFilter(undefined);
                setStatusFilter(undefined);
                setPage(1);
              }}
            >
              Reset
            </Button>
          }
        >
          <FilterField label="Legal entity">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="All entities"
              value={legalEntityFilter}
              onChange={(v) => {
                setLegalEntityFilter(v);
                setPage(1);
              }}
              className="w-[220px]"
              options={(legalEntities.data ?? []).map((l) => ({ value: l.id, label: l.legalName }))}
            />
          </FilterField>
          <FilterField label="Status">
            <Select
              allowClear
              placeholder="All statuses"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              className="w-[150px]"
              options={[
                { value: 'DRAFT', label: 'Draft' },
                { value: 'POSTED', label: 'Posted' },
                { value: 'REVERSED', label: 'Reversed' },
              ]}
            />
          </FilterField>
        </FilterCard>

        <EntityTable<SalaryImportRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={list.isLoading}
          errorMessage={list.isError ? 'Could not load salary imports. Please retry.' : undefined}
          emptyTitle="No salary imports yet"
          emptyDescription="Import a month's gross salary to post it to the ledger and make it available for project allocation."
          page={page}
          pageSize={PAGE_SIZE}
          total={list.data?.total ?? 0}
          onPageChange={(p) => setPage(p)}
        />
      </UiCard>

      <SalaryImportDetailDrawer batch={viewing} onClose={() => setViewing(null)} canPay={canPay} canCreate={canCreate} />

      <PaySalaryModal batch={paying} onClose={() => setPaying(null)} />

      <Modal
        open={reversing !== null}
        title={reversing ? `Reverse ${formatSalaryMonth(reversing.salaryMonth)}` : 'Reverse salary import'}
        okText="Reverse Import"
        okButtonProps={{ danger: true, loading: reverseMutation.isPending }}
        onCancel={() => {
          setReversing(null);
          reverseForm.resetFields();
        }}
        onOk={() => reverseForm.submit()}
      >
        <p className="mb-3 text-[13px] text-muted">
          The posted journal is reversed and this month becomes available to import again. The batch itself is kept as a
          permanent record of what was posted.
        </p>
        <Form<{ reason: string; accountingDate: string }>
          form={reverseForm}
          layout="vertical"
          onFinish={(values) => {
            if (!reversing) return;
            reverseMutation.mutate({
              id: reversing.id,
              expectedVersion: reversing.version,
              reason: values.reason,
              accountingDate: values.accountingDate,
              idempotencyKey: newIdempotencyKey(),
            });
          }}
        >
          <Form.Item label="Reason" name="reason" rules={[{ required: true, message: 'A reason is required.' }]}>
            <Input.TextArea rows={2} placeholder="Why is this import being reversed?" />
          </Form.Item>
          <Form.Item
            label="Reversal accounting date"
            name="accountingDate"
            rules={[{ required: true, message: 'An accounting date is required.' }]}
            getValueProps={() => ({})}
            tooltip="The reversal lands in whatever period is open on this date, independent of the original."
          >
            <DatePicker className="w-full" onChange={(picked) => reverseForm.setFieldValue('accountingDate', isoDate(picked))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/** The committed batch's own rows, the journal it posted, and how much of it
 * has actually been paid (ADR-100). */
function SalaryImportDetailDrawer({
  batch,
  onClose,
  canPay,
  canCreate,
}: {
  batch: SalaryImportRow | null;
  onClose: () => void;
  canPay: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const detail = trpc.salaryImports.getDetail.useQuery({ id: batch?.id ?? '' }, { enabled: batch !== null });
  const lines = detail.data?.lines ?? [];
  const payments = detail.data?.payments ?? [];
  const outstanding = detail.data?.outstandingAmount ?? batch?.outstandingAmount ?? '0';

  const [reverseForm] = Form.useForm<{ reason: string; accountingDate: string }>();
  const [reversingPayment, setReversingPayment] = useState<(typeof payments)[number] | null>(null);

  const reversePaymentMutation = trpc.salaryImports.reversePayment.useMutation({
    onSuccess: () => {
      message.success('Payment reversed. The month is outstanding again.');
      setReversingPayment(null);
      reverseForm.resetFields();
      void utils.salaryImports.getDetail.invalidate();
      void utils.salaryImports.list.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Drawer
      open={batch !== null}
      width={640}
      onClose={onClose}
      title={batch ? `${formatSalaryMonth(batch.salaryMonth)} — ${batch.legalEntityName}` : 'Salary import'}
      extra={
        batch?.journalEntryId ? (
          <Button size="small" onClick={() => router.push(`/journal-entries/${batch.journalEntryId}`)}>
            View Journal
          </Button>
        ) : null
      }
    >
      {batch ? (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="Employees" value={batch.employeeCount} />
            <KpiCard label="Gross Salary" value={<MoneyText tone="neutral">{formatMoney(batch.totalGrossAmount)}</MoneyText>} />
            <KpiCard label="Posted On" value={formatDate(batch.accountingDate)} />
          </div>

          {batch.status === 'DRAFT' ? (
            <div className="mb-4">
              <NextStep
                title="This month is a draft — nothing has posted yet"
                detail="It was built from each employee's salary on record. Review the rows, apply any corrections, then commit it to post the cost and record what is owed."
                {...(canCreate
                  ? {
                      actionLabel: 'Review & Commit',
                      onAction: () => router.push(`/employee-costing/new?draftId=${batch.id}`),
                    }
                  : {})}
              />
            </div>
          ) : null}

          {batch.status === 'POSTED' ? (
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <KpiCard label="Paid" value={<MoneyText tone="neutral">{formatMoney(detail.data?.paidAmount ?? '0')}</MoneyText>} />
              <KpiCard
                label="Still Owed to Staff"
                value={<MoneyText tone={Number(outstanding)> 0 ? 'negative' : 'positive'}>{formatMoney(outstanding)}</MoneyText>}
                sub={Number(outstanding) > 0 ? 'Salary Payable, not yet disbursed' : 'Fully settled'}
              />
            </div>
          ) : null}

          {batch.status === 'POSTED' && Number(outstanding) > 0 && canPay ? (
            <div className="mb-4">
              <NextStep
                title={`${formatMoney(outstanding)} of this month has not been paid yet`}
                detail="Committing the month recorded what is owed. Paying it moves the money out of the bank and clears Salary Payable."
              />
            </div>
          ) : null}

          {payments.length > 0 ? (
            <div className="mb-4">
              <div className="mb-2 text-[13px] font-semibold text-ink">Payments</div>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={payments}
                expandable={{
                  // Who was actually paid, and under which reference — the
                  // question a single header reference could not answer.
                  expandedRowRender: (row) => (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={row.lines}
                      columns={[
                        { title: 'Employee', key: 'employee', render: (_v: unknown, l: (typeof row.lines)[number]) => `${l.employeeCode} — ${l.employeeName}` },
                        { title: 'Settled', dataIndex: 'paidAmount', key: 'paidAmount', align: 'right' as const, render: (v: string) => <span className="font-mono text-[12px]">{formatMoney(v)}</span> },
                        { title: 'TDS', dataIndex: 'tdsAmount', key: 'tdsAmount', align: 'right' as const, render: (v: string) => <span className="font-mono text-[12px] text-muted">{formatMoney(v)}</span> },
                        { title: 'Paid', dataIndex: 'netAmount', key: 'netAmount', align: 'right' as const, render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText> },
                        { title: 'Reference', dataIndex: 'referenceNumber', key: 'referenceNumber', render: (v: string | null) => v ?? '—' },
                      ]}
                    />
                  ),
                }}
                columns={[
                  { title: 'Payment', dataIndex: 'paymentNumber', key: 'paymentNumber', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
                  { title: 'Date', dataIndex: 'paymentDate', key: 'paymentDate', render: (v: string) => formatDate(v) },
                  { title: 'Bank', dataIndex: 'bankAccountName', key: 'bankAccountName' },
                  {
                    title: 'TDS',
                    dataIndex: 'tdsAmount',
                    key: 'tdsAmount',
                    align: 'right' as const,
                    render: (v: string) => <span className="font-mono text-[12px] text-muted">{formatMoney(v)}</span>,
                  },
                  {
                    title: 'Paid',
                    dataIndex: 'netAmount',
                    key: 'netAmount',
                    align: 'right' as const,
                    render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText>,
                  },
                  { title: 'Status', dataIndex: 'status', key: 'status', render: (v: (typeof payments)[number]['status']) => <SalaryPaymentStatusTag status={v} /> },
                  {
                    title: '',
                    key: 'actions',
                    align: 'right' as const,
                    render: (_: unknown, row: (typeof payments)[number]) => (
                      <div className="flex justify-end gap-2">
                        <Button size="small" onClick={() => router.push(`/journal-entries/${row.journalEntryId}`)}>
                          Journal
                        </Button>
                        {canPay && row.status === 'POSTED' ? (
                          <Button size="small" danger onClick={() => setReversingPayment(row)}>
                            Reverse
                          </Button>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          ) : null}

          {batch.status === 'REVERSED' ? (
            <div className="mb-4 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-muted">
              Reversed{batch.reversalReason ? `: ${batch.reversalReason}` : ''}. The rows below are kept as the permanent
              record of what was posted.
            </div>
          ) : null}

          <Table
            rowKey="id"
            size="small"
            pagination={false}
            loading={detail.isLoading}
            dataSource={lines}
            columns={[
              { title: 'Code', dataIndex: 'employeeCode', key: 'employeeCode', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
              { title: 'Employee', dataIndex: 'employeeName', key: 'employeeName' },
              {
                title: 'Gross Salary',
                dataIndex: 'grossSalaryAmount',
                key: 'grossSalaryAmount',
                align: 'right' as const,
                render: (v: string) => <MoneyText tone="neutral">{formatMoney(v)}</MoneyText>,
              },
              // Per person, not just per month — the whole reason payments
              // carry employee lines (ADR-101).
              ...(batch.status === 'POSTED'
                ? [
                    {
                      title: 'Still Owed',
                      dataIndex: 'outstandingAmount',
                      key: 'outstandingAmount',
                      align: 'right' as const,
                      render: (v: string) =>
                        Number(v) === 0 ? (
                          <span className="text-[12px] font-semibold text-positive">Settled</span>
                        ) : (
                          <MoneyText tone="negative">{formatMoney(v)}</MoneyText>
                        ),
                    },
                  ]
                : []),
            ]}
          />

          <Modal
            open={reversingPayment !== null}
            title={reversingPayment ? `Reverse ${reversingPayment.paymentNumber}` : 'Reverse payment'}
            okText="Reverse Payment"
            okButtonProps={{ danger: true, loading: reversePaymentMutation.isPending }}
            onCancel={() => {
              setReversingPayment(null);
              reverseForm.resetFields();
            }}
            onOk={() => reverseForm.submit()}
          >
            <p className="mb-3 text-[13px] text-muted">
              The payment&rsquo;s journal is reversed and this month becomes outstanding again. The payment record itself is
              kept.
            </p>
            <Form<{ reason: string; accountingDate: string }>
              form={reverseForm}
              layout="vertical"
              onFinish={(values) => {
                if (!reversingPayment) return;
                reversePaymentMutation.mutate({
                  id: reversingPayment.id,
                  expectedVersion: reversingPayment.version,
                  reason: values.reason,
                  accountingDate: values.accountingDate,
                  idempotencyKey: newIdempotencyKey(),
                });
              }}
            >
              <Form.Item label="Reason" name="reason" rules={[{ required: true, message: 'A reason is required.' }]}>
                <Input.TextArea rows={2} placeholder="Why is this payment being reversed?" />
              </Form.Item>
              <Form.Item
                label="Reversal accounting date"
                name="accountingDate"
                rules={[{ required: true, message: 'An accounting date is required.' }]}
                getValueProps={() => ({})}
              >
                <DatePicker className="w-full" onChange={(picked) => reverseForm.setFieldValue('accountingDate', isoDate(picked))} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      ) : null}
    </Drawer>
  );
}

/**
 * Settling a posted month, employee by employee (ADR-101).
 *
 * The month's own rows ARE the payment form: each employee carries what they
 * are still owed, what is being paid now, what is withheld, and the reference
 * for that specific bank credit. A single amount with a single reference
 * could not describe a payroll run, which is several credits with several
 * UTRs.
 *
 * The screen never computes a figure it then posts — it sends per-employee
 * amounts and the server derives every total and every ledger line.
 */
function PaySalaryModal({ batch, onClose }: { batch: SalaryImportRow | null; onClose: () => void }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [form] = Form.useForm<PayFormValues>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey());

  const detail = trpc.salaryImports.getDetail.useQuery({ id: batch?.id ?? '' }, { enabled: batch !== null });
  // Only people who still have something owed for this month.
  const owed = (detail.data?.lines ?? []).filter((l) => Number(l.outstandingAmount) > 0);


  const rows = (Form.useWatch('rows', form) ?? []) as PayRow[];
  const totalPaying = rows.reduce((sum, r) => sum + Number(r?.paidAmount ?? 0), 0);
  const totalTds = rows.reduce((sum, r) => sum + Number(r?.tdsAmount ?? 0), 0);
  const leavingBank = Math.max(0, totalPaying - totalTds);

  const payMutation = trpc.salaryImports.pay.useMutation({
    onSuccess: (payment) => {
      message.success(`${payment.paymentNumber} posted — ${formatMoney(payment.netAmount)} paid to ${payment.lines.length} employee${payment.lines.length === 1 ? '' : 's'}.`);
      setIdempotencyKey(newIdempotencyKey());
      form.resetFields();
      onClose();
      void utils.salaryImports.list.invalidate();
      void utils.salaryImports.getDetail.invalidate();
    },
    onError: (error) => message.error(error.message),
  });

  // Everyone starts pre-filled at their full outstanding — the common case is
  // paying the month in full, and zeroing a row is easier than typing every
  // figure. Keyed on the batch so reopening for a different month re-seeds.
  const initialRows: PayRow[] = owed.map((l) => ({
    employeeId: l.employeeId,
    paidAmount: Number(l.outstandingAmount),
    tdsAmount: 0,
    referenceNumber: undefined,
  }));

  const columns = [
    {
      title: 'Employee',
      key: 'employee',
      render: (_v: unknown, _r: PayRow, index: number) => {
        const line = owed[index];
        return (
          <div>
            <div className="font-semibold text-ink">{line?.employeeName}</div>
            <div className="font-mono text-[11px] text-muted">{line?.employeeCode}</div>
          </div>
        );
      },
    },
    {
      title: 'Owed',
      key: 'owed',
      align: 'right' as const,
      render: (_v: unknown, _r: PayRow, index: number) => (
        <span className="font-mono text-[12px] text-muted">{formatMoney(owed[index]?.outstandingAmount ?? '0')}</span>
      ),
    },
    {
      title: 'Paying',
      key: 'paidAmount',
      align: 'right' as const,
      render: (_v: unknown, _r: PayRow, index: number) => (
        <Form.Item name={['rows', index, 'paidAmount']} noStyle>
          <InputNumber className="w-[120px]" min={0} max={Number(owed[index]?.outstandingAmount ?? 0)} precision={2} />
        </Form.Item>
      ),
    },
    {
      title: 'TDS',
      key: 'tdsAmount',
      align: 'right' as const,
      render: (_v: unknown, _r: PayRow, index: number) => (
        <Form.Item name={['rows', index, 'tdsAmount']} noStyle>
          <InputNumber className="w-[100px]" min={0} precision={2} />
        </Form.Item>
      ),
    },
    {
      title: 'Reference',
      key: 'referenceNumber',
      render: (_v: unknown, _r: PayRow, index: number) => (
        <Form.Item name={['rows', index, 'referenceNumber']} noStyle>
          <Input className="w-[150px]" placeholder="UTR / NEFT" />
        </Form.Item>
      ),
    },
  ];

  return (
    <Modal
      open={batch !== null}
      width={860}
      title={batch ? `Pay ${formatSalaryMonth(batch.salaryMonth)}` : 'Pay salary'}
      okText="Post Payment"
      okButtonProps={{ loading: payMutation.isPending, disabled: owed.length === 0 || totalPaying <= 0 }}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      {batch ? (
        <>
          <p className="mb-3 text-[13px] text-muted">
            {formatMoney(batch.outstandingAmount)} is still owed for this month, across {owed.length} employee
            {owed.length === 1 ? '' : 's'}. Each row posts its own debit to Salary Payable, so what is owed to one person
            stays answerable. Zero a row to leave that person unpaid for now.
          </p>
          <Form<PayFormValues>
            form={form}
            layout="vertical"
            key={batch.id}
            initialValues={{ rows: initialRows }}
            onFinish={(values) => {
              const lines = (values.rows ?? [])
                .map((r, index) => ({
                  employeeId: owed[index]?.employeeId ?? r.employeeId,
                  paidAmount: Number(r?.paidAmount ?? 0).toFixed(2),
                  tdsAmount: Number(r?.tdsAmount ?? 0).toFixed(2),
                  referenceNumber: r?.referenceNumber?.trim() || undefined,
                }))
                // A zeroed row is "not paying this person now", not an error.
                .filter((l) => Number(l.paidAmount) > 0);
              if (lines.length === 0) {
                message.error('Enter an amount for at least one employee.');
                return;
              }
              payMutation.mutate({
                salaryImportId: batch.id,
                bankAccountId: values.bankAccountId,
                paymentDate: values.paymentDate,
                referenceNumber: values.referenceNumber?.trim() || undefined,
                lines,
                idempotencyKey,
              });
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Only the paying entity's own accounts: the cost was recognised in one
                  legal entity, and the server refuses cash leaving any other. */}
              <Form.Item label="Bank account" name="bankAccountId" rules={[{ required: true, message: 'A bank account is required.' }]}>
                <BankAccountSelect legalEntityId={batch?.legalEntityId} placeholder="Select bank account…" />
              </Form.Item>
              <Form.Item
                label="Payment date"
                name="paymentDate"
                rules={[{ required: true, message: 'A payment date is required.' }]}
                getValueProps={() => ({})}
              >
                <DatePicker className="w-full" onChange={(picked) => form.setFieldValue('paymentDate', isoDate(picked))} />
              </Form.Item>
              <Form.Item
                label="Batch reference"
                name="referenceNumber"
                tooltip="Optional — for a single bulk file uploaded to the bank. Each employee's own UTR goes on their row."
>
                <Input placeholder="Optional" />
              </Form.Item>
            </div>

            <Table<PayRow>
              rowKey={(_r, index) => owed[index ?? 0]?.employeeId ?? String(index)}
              size="small"
              pagination={false}
              loading={detail.isLoading}
              dataSource={initialRows}
              columns={columns}
              locale={{ emptyText: 'Every employee in this month has been paid.' }}
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-ui border border-ui bg-paper p-3 text-[12.5px] text-muted">
              <span>
                Settling <span className="font-mono font-semibold text-ink">{formatMoney(totalPaying.toFixed(2))}</span>
                {totalTds > 0 ? (
                  <>
                    {' '}· TDS withheld <span className="font-mono font-semibold text-ink">{formatMoney(totalTds.toFixed(2))}</span>
                  </>
                ) : null}
              </span>
              <span>
                Leaving the bank: <span className="font-mono font-semibold text-ink">{formatMoney(leavingBank.toFixed(2))}</span>
              </span>
            </div>
          </Form>
        </>
      ) : null}
    </Modal>
  );
}
