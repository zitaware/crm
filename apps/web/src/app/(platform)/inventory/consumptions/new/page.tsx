'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { App, Alert, Button, Form, Input, InputNumber } from 'antd';
import { DatePicker } from '@/components/masked-date-picker';
import { MoneyText, PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { ProjectSelect } from '@/components/project-select';
import { ProductSelect } from '@/components/product-select';
import { formatMoney } from '@/lib/format';
import { formatQuantity, newIdempotencyKey } from '../../shared';
import { isoDate } from '@/lib/dates';

interface LineValue {
  inventoryItemId?: string;
  quantity?: number;
}

interface FormValues {
  projectId: string;
  consumedDate: string;
  note?: string;
  lines: LineValue[];
}

export default function NewStockConsumptionPage() {
  // useSearchParams requires a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <NewStockConsumptionForm />
    </Suspense>
  );
}

function NewStockConsumptionForm() {
  const router = useRouter();
  // Seeded when the user arrived from a project's Costs tab, so the project
  // they came from is not thrown away on the way here.
  const seededProjectId = useSearchParams().get('projectId');
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [idempotencyKey] = useState(newIdempotencyKey());

  const projects = trpc.projects.list.useQuery();

  const projectId = Form.useWatch('projectId', form) as string | undefined;
  const lines = (Form.useWatch('lines', form) ?? []) as LineValue[];

  // Only complete lines are worth quoting. Keyed on the serialized form (and
  // re-read from it) so the query input is referentially stable across the
  // renders Form.useWatch fires that did not actually change a line.
  const linesKey = JSON.stringify(lines);
  const quotableLines = useMemo(() => {
    const parsed = JSON.parse(linesKey) as LineValue[];
    return parsed
      .filter((l): l is { inventoryItemId: string; quantity: number } => Boolean(l?.inventoryItemId) && Number(l?.quantity) > 0)
      .map((l) => ({ inventoryItemId: l.inventoryItemId, quantity: String(l.quantity) }));
  }, [linesKey]);

  /**
   * The valuation is entirely server-computed — this screen never multiplies
   * a quantity by a rate itself. Consumption is issued at the ruling
   * weighted average, and a full depletion carries out the whole residual
   * balance rather than quantity x rate, so any client-side arithmetic here
   * would be wrong precisely when it matters most.
   */
  const preview = trpc.inventory.previewConsumption.useQuery(
    { lines: quotableLines },
    { enabled: quotableLines.length > 0 },
  );

  const selectedProject = (projects.data ?? []).find((p) => p.id === projectId);

  const recordMutation = trpc.inventory.recordConsumption.useMutation({
    onSuccess: (consumption) => {
      message.success(`${consumption.consumptionNumber} posted — ${formatMoney(consumption.totalValueAmount)} charged to ${consumption.projectName}.`);
      router.push(seededProjectId ? `/projects/${seededProjectId}?tab=costs` : '/inventory');
    },
    onError: (error) => message.error(error.message),
  });

  const handleFinish = (values: FormValues) => {
    if (!selectedProject) {
      message.error('Select a project first.');
      return;
    }
    recordMutation.mutate({
      // The cost belongs to the entity that owns the project — the server
      // rejects any other, so it is derived here rather than asked for.
      legalEntityId: selectedProject.legalEntityId,
      projectId: values.projectId,
      consumedDate: values.consumedDate,
      note: values.note?.trim() || undefined,
      lines: (values.lines ?? [])
        .filter((l) => l?.inventoryItemId && l?.quantity)
        .map((l) => ({ inventoryItemId: l.inventoryItemId!, quantity: String(l.quantity) })),
      idempotencyKey,
    });
  };

  const shortfalls = (preview.data?.lines ?? []).filter((l) => l.shortfallMessage);

  return (
    <>
      <PageHeader
        title="Issue Stock to Project"
        description="Stock leaves the central store at the ruling weighted average and is charged to the project as material cost."
        actions={
          <Button
            size="small"
            onClick={() => router.push(seededProjectId ? `/projects/${seededProjectId}?tab=costs` : '/inventory')}
          >
            {seededProjectId ? 'Back to Project' : 'Back to Inventory'}
          </Button>
        }
      />

      <UiCard>
        <Form<FormValues> form={form} layout="vertical" initialValues={{ lines: [{}], ...(seededProjectId ? { projectId: seededProjectId } : {}) }} onFinish={handleFinish}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {seededProjectId ? (
              <>
                <Form.Item label="Project" tooltip="Fixed — you came here from this project.">
                  <Input disabled value={selectedProject?.name ?? '—'} />
                </Form.Item>
                <Form.Item name="projectId" hidden rules={[{ required: true, message: 'Project is required.' }]}>
                  <Input type="hidden" />
                </Form.Item>
              </>
            ) : (
              <Form.Item
                label="Project"
                name="projectId"
                rules={[{ required: true, message: 'Project is required.' }]}
                tooltip="Material cost is charged to this project. A cancelled or closed project cannot be charged."
>
                <ProjectSelect placeholder="Select project…" />
              </Form.Item>
            )}
            <Form.Item label="Issue date" name="consumedDate" rules={[{ required: true, message: 'Issue date is required.' }]} getValueProps={() => ({})}>
              <DatePicker className="w-full" onChange={(picked) => form.setFieldValue('consumedDate', isoDate(picked))} />
            </Form.Item>
            <Form.Item label="Legal entity">
              <Input disabled value={selectedProject?.legalEntityName ?? '—'} />
            </Form.Item>
            <Form.Item label="Note" name="note" className="md:col-span-3">
              <Input.TextArea rows={2} placeholder="Optional — e.g. site, indent reference" />
            </Form.Item>
          </div>

          <div className="mb-2 text-[13px] font-semibold text-ink">Items issued</div>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <div className="flex flex-col gap-3">
                {fields.map(({ key, ...field }, index) => {
                  const quoted = preview.data?.lines[index];
                  return (
                    <div key={key} className="rounded-ui border border-ui p-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                        <Form.Item
                          {...field}
                          label="Item"
                          name={[field.name, 'inventoryItemId']}
                          className="md:col-span-2"
                          rules={[{ required: true, message: 'Item is required.' }]}
>
                          <ProductSelect stockTrackedOnly />
                        </Form.Item>
                        <Form.Item {...field} label="Quantity" name={[field.name, 'quantity']} rules={[{ required: true, message: 'Quantity is required.' }]}>
                          <InputNumber className="w-full" min={0.0001} precision={4} placeholder="0" />
                        </Form.Item>
                        <Form.Item label="Value at avg. rate" tooltip="Computed by the server at the ruling weighted average.">
                          <div className="flex h-[32px] items-center text-[13px]">
                            {quoted ? (
                              <span>
                                <MoneyText tone="neutral">{formatMoney(quoted.lineValueAmount)}</MoneyText>
                                <span className="ml-2 text-[12px] text-muted">
                                  {formatQuantity(quoted.quantityOnHand)} on hand @ {formatMoney(quoted.weightedAverageRate)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </div>
                        </Form.Item>
                      </div>
                      {quoted?.shortfallMessage ? (
                        <Alert type="error" showIcon className="mt-1" message={quoted.shortfallMessage} />
                      ) : null}
                      {fields.length > 1 ? (
                        <div className="flex justify-end">
                          <Button size="small" danger onClick={() => remove(field.name)}>
                            Remove line
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div>
                  <Button onClick={() => add({})}>Add line</Button>
                </div>
              </div>
            )}
          </Form.List>

          {shortfalls.length > 0 ? (
            <Alert
              className="mt-4"
              type="warning"
              showIcon
              message="Not enough stock on hand"
              description="Reduce the quantities, or receive more stock first. Nothing is posted until every line can be issued."
            />
          ) : null}

          <div className="mt-4 flex items-center justify-between border-t border-ui pt-3">
            <div className="text-[13px] text-muted">
              Material cost:{' '}
              <span className="font-semibold text-ink">{formatMoney(preview.data?.totalValueAmount ?? '0')}</span>
              <span className="ml-2 text-[12px]">(re-confirmed against live stock when posted)</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => router.push('/inventory')}>Cancel</Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={recordMutation.isPending}
                disabled={quotableLines.length === 0 || shortfalls.length> 0}
              >
                Post Issue
              </Button>
            </div>
          </div>
        </Form>
      </UiCard>
    </>
  );
}
