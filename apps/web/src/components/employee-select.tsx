'use client';

import { useState } from 'react';
import dayjs from 'dayjs';
import { App, Form, Input, Modal, Select, Switch } from 'antd';
import { MoneyInput } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { DateInput } from '@/components/date-input';
import { MasterSelect } from '@/components/master-select';
import { LegalEntitySelect, employeeOptions } from '@/components/legal-entity-select';

interface QuickEmployee {
  employeeCode: string;
  fullName: string;
  legalEntityId?: string;
  internalDepartmentId?: string;
  designationId?: string;
  employmentTypeId?: string;
  isReimbursable?: boolean;
  displayedSalaryAmount?: string;
  joiningDate: string;
}

/**
 * The employee picker on entry forms. It lists "Name · Code", only those of
 * `legalEntityId` when one is given (ADR-183). F2 opens the same fields as
 * Add Employee, with what was typed as the name and the form's legal entity,
 * and selects the new employee. Adding is offered only to those who may
 * manage employees.
 */
export function EmployeeSelect({
  value,
  onChange,
  legalEntityId,
  reimbursableOnly,
  placeholder = 'Select employee…',
  allowClear,
  disabled,
}: {
  value?: string | undefined;
  onChange?: (value: string | undefined) => void;
  /** Lists only this legal entity's employees, and adds the new one to it. */
  legalEntityId?: string | undefined;
  /** Lists only employees who can claim expenses; a new one is added as such. */
  reimbursableOnly?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const employees = trpc.employees.list.useQuery({ includeInactive: false });
  const canAdd = (trpc.auth.me.useQuery().data?.permissions ?? []).includes('employee.manage');
  const legalEntities = trpc.legalEntities.list.useQuery({ includeInactive: false }, { enabled: !!legalEntityId });
  const fixedEntityName = legalEntityId ? (legalEntities.data ?? []).find((l) => l.id === legalEntityId)?.legalName : undefined;
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Array<{ value: string; label: string }>>([]);
  const [form] = Form.useForm<QuickEmployee>();

  const rows = (employees.data ?? []).filter((e) => !reimbursableOnly || e.isReimbursable);
  const options = employeeOptions(rows, legalEntityId);
  // Shown until the refreshed list has it.
  for (const extra of added) if (!options.some((o) => o.value === extra.value)) options.push(extra);

  const create = trpc.employees.create.useMutation({
    onSuccess: async (employee) => {
      message.success(`Employee ${employee.fullName} added.`);
      setAdded((current) => [...current, { value: employee.id, label: `${employee.fullName} · ${employee.employeeCode}` }]);
      await utils.employees.list.invalidate();
      onChange?.(employee.id);
      setAdding(false);
    },
    onError: (error) => message.error(error.message),
  });

  const openAdd = () => {
    if (!canAdd || disabled) return;
    form.resetFields();
    form.setFieldsValue({ fullName: search.trim(), joiningDate: dayjs().format('YYYY-MM-DD'), isReimbursable: !!reimbursableOnly });
    setAdding(true);
  };
  const onF2 = (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
    // F2 inside the open box belongs to its own pickers (department, designation…).
    if (event.key !== 'F2' || adding) return;
    event.preventDefault();
    event.stopPropagation();
    openAdd();
  };

  return (
    <div className="w-full" onKeyDownCapture={onF2}>
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        placeholder={placeholder}
        loading={employees.isLoading}
        value={value ?? null}
        onChange={(next: string | null | undefined) => onChange?.(next ?? undefined)}
        onSearch={setSearch}
        {...(disabled ? { disabled: true } : {})}
        {...(allowClear ? { allowClear: true } : {})}
        options={options}
        dropdownRender={(menu) => (
          <>
            {menu}
            {canAdd ? (
              <button type="button" className="w-full border-t border-ui px-3 py-1.5 text-left text-[11px] text-muted hover:text-brand" onMouseDown={(e) => e.preventDefault()} onClick={openAdd}>
                Press F2 (or click here) to add a new employee{search.trim() ? ` “${search.trim()}”` : ''}
              </button>
            ) : null}
          </>
        )}
      />
      <Modal open={adding} width={720} title="Add employee" okText="Add employee" confirmLoading={create.isPending} onCancel={() => setAdding(false)} onOk={() => form.submit()} destroyOnHidden>
        <Form<QuickEmployee>
          form={form}
          layout="vertical"
          requiredMark
          onFinish={(v) =>
            create.mutate({
              employeeCode: v.employeeCode.trim(),
              fullName: v.fullName.trim(),
              legalEntityId: legalEntityId ?? v.legalEntityId,
              internalDepartmentId: v.internalDepartmentId || undefined,
              designationId: v.designationId || undefined,
              employmentTypeId: v.employmentTypeId || undefined,
              isReimbursable: reimbursableOnly ? true : !!v.isReimbursable,
              displayedSalaryAmount: v.displayedSalaryAmount || undefined,
              joiningDate: v.joiningDate,
            })
          }
        >
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Form.Item label="Employee code" name="employeeCode" rules={[{ required: true, whitespace: true, message: 'Employee code is required.' }, { max: 50 }]} extra="A short immutable identifier (e.g. EMP001).">
              <Input placeholder="e.g. EMP001" />
            </Form.Item>
            <Form.Item label="Full name" name="fullName" rules={[{ required: true, whitespace: true, message: 'Full name is required.' }, { max: 200 }]}>
              <Input autoFocus placeholder="e.g. Asha Verma" />
            </Form.Item>
          </div>
          {legalEntityId ? (
            <Form.Item label="Legal entity" required extra="The legal entity chosen on this form.">
              <Input value={fixedEntityName ?? ''} disabled />
            </Form.Item>
          ) : (
            <Form.Item label="Legal entity" name="legalEntityId" rules={[{ required: true, message: 'Legal entity is required.' }]} extra="The company this employee works for.">
              <LegalEntitySelect placeholder="Select legal entity" />
            </Form.Item>
          )}
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
            <Form.Item label="Department" name="internalDepartmentId">
              <MasterSelect type="internal_departments" allowClear placeholder="Select department" />
            </Form.Item>
            <Form.Item label="Designation" name="designationId">
              <MasterSelect type="designations" allowClear placeholder="Select designation" />
            </Form.Item>
            <Form.Item label="Employment type" name="employmentTypeId">
              <MasterSelect type="employment_types" allowClear placeholder="Select employment type" />
            </Form.Item>
          </div>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
            <Form.Item label="Joining date" name="joiningDate" rules={[{ required: true, message: 'Joining date is required.' }]}>
              <DateInput />
            </Form.Item>
            <Form.Item
              label="Monthly gross salary"
              name="displayedSalaryAmount"
              rules={[{ pattern: /^\d{1,15}(\.\d{1,4})?$/, message: 'Enter a valid amount, e.g. 55000 or 55000.50' }]}
              extra="Their first salary revision, from the joining date."
            >
              <MoneyInput placeholder="e.g. 55000" />
            </Form.Item>
            <Form.Item label="Reimbursable" name="isReimbursable" valuePropName="checked" extra={reimbursableOnly ? 'Needed to claim expenses.' : undefined}>
              <Switch disabled={!!reimbursableOnly} />
            </Form.Item>
          </div>
          <p className="m-0 text-[12px] text-muted">Login access can be given later from the employee in Employees.</p>
        </Form>
      </Modal>
    </div>
  );
}
