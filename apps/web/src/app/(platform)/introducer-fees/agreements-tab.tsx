'use client';

import { useState } from 'react';
import { App, Button, Drawer, Form, Input, InputNumber, Modal, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EntityTable, FilterCard, MoneyText, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { IntroducerSelect } from '@/components/introducer-select';
import { ProjectSelect } from '@/components/project-select';
import { formatDate, formatMoney } from '@/lib/format';
import {
  describeBasis,
  newIdempotencyKey,
  type IntroducerAgreementRow,
  type IntroducerCommissionBasis,
} from './shared';
import { DateInput } from '@/components/date-input';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Agreements list plus the Add-Agreement drawer and the Accrue modal.
 *
 * `projectId` makes this reusable as the project detail page's own
 * Introducer tab: the list narrows to that project, and the Add drawer
 * pre-fills and locks the project — and pre-fills the introducer from
 * `Project.introducerId`, the link that has existed since Phase 3.4 and
 * which the global form ignored until ADR-097.
 */

/** `pct`% of `total`, in whole paise, so the suggested amount has no float residue. */
function shareOf(total: string, pct: number): number {
  const totalPaise = Math.round(Number(total) * 100);
  return Math.round((totalPaise * Math.round(pct * 100)) / 10000) / 100;
}

/** What share of `total` the typed amount is, to two decimals; shown only. */
function percentOf(amount: number, total: string): number | null {
  const totalPaise = Math.round(Number(total) * 100);
  if (totalPaise <= 0) return null;
  return Math.round((Math.round(amount * 100) * 10000) / totalPaise) / 100;
}

export function AgreementsTab({ canCreate, projectId }: { canCreate: boolean; projectId?: string | undefined }) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [accruing, setAccruing] = useState<IntroducerAgreementRow | null>(null);
  const [form] = Form.useForm<{ introducerId: string; projectId: string; basisType: IntroducerCommissionBasis; ratePercent?: number; fixedAmount?: number; agreementDate: string; remarks?: string }>();
  const [accrualForm] = Form.useForm<{ accrualDate: string; percent?: number | null; amount: number; narrative?: string }>();

  const projects = trpc.projects.list.useQuery();
  const agreements = trpc.introducerFees.listAgreements.useQuery({ includeInactive: true, projectId });

  // The project's own introducer, when this tab is scoped to one — the
  // default the Add drawer opens with.
  const scopedProject = projectId ? (projects.data ?? []).find((p) => p.id === projectId) : undefined;
  const rows = (agreements.data?.rows ?? []) as IntroducerAgreementRow[];

  const basisType = Form.useWatch('basisType', form) ?? 'PERCENT_OF_PROJECT_VALUE';

  const refresh = () => {
    void utils.introducerFees.listAgreements.invalidate();
    void utils.introducerFees.listAccruals.invalidate();
    void utils.introducerFees.listBalances.invalidate();
  };

  const createMutation = trpc.introducerFees.createAgreement.useMutation({
    onSuccess: () => {
      message.success('Agreement created.');
      setAdding(false);
      form.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });
  const accrualMutation = trpc.introducerFees.postAccrual.useMutation({
    onSuccess: (accrual) => {
      message.success(`${accrual.accrualNumber} posted.`);
      setAccruing(null);
      accrualForm.resetFields();
      refresh();
    },
    onError: (error) => message.error(error.message),
  });

  const openAdd = () => {
    form.resetFields();
    if (projectId) {
      form.setFieldsValue({
        projectId,
        // May be undefined if the project names no introducer; the field is
        // then simply empty rather than pre-filled with a guess.
        ...(scopedProject?.introducerId ? { introducerId: scopedProject.introducerId } : {}),
      });
    }
    setAdding(true);
  };

  const columns: ColumnsType<IntroducerAgreementRow> = [
    { title: 'Introducer', dataIndex: 'introducerName', key: 'introducerName', render: (v: string) => <span className="font-semibold text-ink">{v}</span> },
    { title: 'Project', dataIndex: 'projectName', key: 'projectName' },
    { title: 'Basis', key: 'basis', render: (_: unknown, row) => describeBasis(row) },
    { title: 'Date', dataIndex: 'agreementDate', key: 'agreementDate', render: (v: string) => formatDate(v) },
    {
      title: 'Entitled',
      dataIndex: 'entitledAmount',
      key: 'entitledAmount',
      align: 'right',
      // Null is a real answer, not a zero: a percentage agreement on a
      // project with no value yet has no knowable ceiling.
      render: (v: string | null) => (v ? <MoneyText tone="neutral">{formatMoney(v)}</MoneyText> : <span className="text-muted">Project value not set</span>),
    },
    { title: 'Accrued', dataIndex: 'accruedAmount', key: 'accruedAmount', align: 'right', render: (v: string) => formatMoney(v) },
    {
      title: 'Left to accrue',
      dataIndex: 'remainingToAccrue',
      key: 'remainingToAccrue',
      align: 'right',
      render: (v: string | null) => (v ? formatMoney(v) : '—'),
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      render: (_: unknown, row) =>
        canCreate && row.isActive ? (
          <Button size="small" onClick={() => setAccruing(row)}>
            Accrue
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <UiCard flush>
        <FilterCard actions={canCreate ? <Button type="primary" onClick={openAdd}>Add Agreement</Button> : undefined}>
          <div className="text-[13px] text-muted">
            An agreement records what an introducer is entitled to. It posts nothing — commission becomes a liability when
            it is accrued.
          </div>
        </FilterCard>

        <EntityTable<IntroducerAgreementRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={agreements.isLoading}
          errorMessage={agreements.isError ? 'Could not load agreements. Please retry.' : undefined}
          emptyTitle="No agreements yet"
          emptyDescription="Record what each introducer is owed on a project, then accrue it when it is earned."
          page={1}
          pageSize={rows.length || 1}
          total={rows.length}
          onPageChange={() => undefined}
        />
      </UiCard>

      <Drawer
        open={adding}
        width={620}
        title="Add Introducer Agreement"
        onClose={() => {
          setAdding(false);
          form.resetFields();
        }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ basisType: 'PERCENT_OF_PROJECT_VALUE' }}
          onFinish={(values) =>
            createMutation.mutate({
              introducerId: values.introducerId,
              projectId: values.projectId,
              basisType: values.basisType,
              // Exactly one of the two is sent — the server, the router schema
              // and a DB CHECK all refuse the other combinations.
              ratePercent: values.basisType === 'PERCENT_OF_PROJECT_VALUE' ? String(values.ratePercent) : undefined,
              fixedAmount: values.basisType === 'FIXED_AMOUNT' ? String(values.fixedAmount) : undefined,
              agreementDate: values.agreementDate,
              remarks: values.remarks?.trim() || undefined,
              idempotencyKey: newIdempotencyKey(),
            })
          }
        >
          <Form.Item label="Introducer" name="introducerId" rules={[{ required: true, message: 'Introducer is required.' }]}>
            <IntroducerSelect placeholder="Select introducer…" />
          </Form.Item>
          <Form.Item label="Project" name="projectId" rules={[{ required: true, message: 'Project is required.' }]}>
            <ProjectSelect
              placeholder="Select project…"
              // Locked when this tab is already scoped to one project.
              {...(projectId ? { disabled: true } : {})}
              onChange={(_id, project) => {
                // Follow the project's own introducer, so the two can't drift
                // apart by accident on the global form either.
                if (project?.introducerId) form.setFieldValue('introducerId', project.introducerId);
              }}
            />
          </Form.Item>
          <Form.Item label="Commission basis" name="basisType" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'PERCENT_OF_PROJECT_VALUE', label: 'Percentage of project value' },
                { value: 'FIXED_AMOUNT', label: 'Fixed amount' },
              ]}
            />
          </Form.Item>
          {basisType === 'PERCENT_OF_PROJECT_VALUE' ? (
            <Form.Item label="Rate %" name="ratePercent" rules={[{ required: true, message: 'Rate is required.' }]}>
              <InputNumber className="w-full" min={0.0001} max={100} precision={4} placeholder="e.g. 2.5" />
            </Form.Item>
          ) : (
            <Form.Item label="Fixed amount" name="fixedAmount" rules={[{ required: true, message: 'Amount is required.' }]}>
              <InputNumber className="w-full" min={0.01} precision={2} placeholder="0.00" />
            </Form.Item>
          )}
          <Form.Item label="Agreement date" name="agreementDate" rules={[{ required: true, message: 'Date is required.' }]}>
            <DateInput />
          </Form.Item>
          <Form.Item label="Remarks" name="remarks">
            <Input.TextArea rows={2} placeholder="Optional" />
          </Form.Item>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="primary" loading={createMutation.isPending} onClick={() => form.submit()}>
              Create Agreement
            </Button>
          </div>
        </Form>
      </Drawer>

      <Modal
        open={accruing !== null}
        title={accruing ? `Accrue commission — ${accruing.introducerName}` : 'Accrue commission'}
        okText="Post Accrual"
        okButtonProps={{ loading: accrualMutation.isPending }}
        onCancel={() => {
          setAccruing(null);
          accrualForm.resetFields();
        }}
        onOk={() => accrualForm.submit()}
      >
        <p className="mb-3 text-[13px] text-muted">
          Posts Dr Introducer Commission Expense / Cr Introducer Payable against{' '}
          <span className="font-semibold text-ink">{accruing?.projectName}</span>.
          {accruing?.remainingToAccrue ? ` ${formatMoney(accruing.remainingToAccrue)} of this agreement is still to accrue.` : ''}
        </p>
        <Form
          form={accrualForm}
          layout="vertical"
          initialValues={{ accrualDate: today() }}
          onFinish={(values) => {
            if (!accruing) return;
            accrualMutation.mutate({
              introducerAgreementId: accruing.id,
              accrualDate: values.accrualDate,
              amount: String(values.amount),
              narrative: values.narrative?.trim() || undefined,
              idempotencyKey: newIdempotencyKey(),
            });
          }}
        >
          <Form.Item label="Accrual date" name="accrualDate" rules={[{ required: true, message: 'Accrual date is required.' }]}>
            <DateInput />
          </Form.Item>
          {/* Either can be typed; the other follows. Only the amount is posted. */}
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Form.Item
              label="Percentage"
              name="percent"
              extra={accruing?.entitledAmount ? `of ${formatMoney(accruing.entitledAmount)} total commission` : 'Total commission not known yet'}
            >
              <InputNumber
                className="w-full"
                min={0.01}
                max={100}
                precision={2}
                placeholder="0.00"
                addonAfter="%"
                disabled={!accruing?.entitledAmount}
                onChange={(pct) => {
                  if (pct === null || !accruing?.entitledAmount) return;
                  accrualForm.setFieldValue('amount', shareOf(accruing.entitledAmount, Number(pct)));
                }}
              />
            </Form.Item>
            <Form.Item label="Amount" name="amount" rules={[{ required: true, message: 'Amount is required.' }]}>
              <InputNumber
                className="w-full"
                min={0.01}
                precision={2}
                placeholder="0.00"
                onChange={(amount) => {
                  if (amount === null || !accruing?.entitledAmount) return;
                  accrualForm.setFieldValue('percent', percentOf(Number(amount), accruing.entitledAmount));
                }}
              />
            </Form.Item>
          </div>
          <Form.Item label="Narrative" name="narrative">
            <Input placeholder="Optional — e.g. Stage 1" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
 