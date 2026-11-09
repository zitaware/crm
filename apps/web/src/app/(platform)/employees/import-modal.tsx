'use client';

import { useState } from 'react';
import { Alert, App, Button, Modal, Table, Tag, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { StatusTag } from '@zitaware/ui';
import type { EmployeeImportPreviewRow } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';

export function downloadWorkbook(contentBase64: string, filename: string) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function ImportEmployeesModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const [contentBase64, setContentBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const preview = trpc.employees.previewImport.useMutation({
    onError: (error) => message.error(error.message),
  });
  const importRows = trpc.employees.importRows.useMutation({
    onSuccess: async (result) => {
      message.success(
        [result.created ? `${result.created} added` : null, result.updated ? `${result.updated} updated` : null, result.unchanged ? `${result.unchanged} unchanged` : null]
          .filter(Boolean)
          .join(', ') + '.',
      );
      setContentBase64(null);
      setFileName(null);
      preview.reset();
      await onImported();
      onClose();
    },
    onError: (error) => message.error(error.message),
  });

  const close = () => {
    setContentBase64(null);
    setFileName(null);
    preview.reset();
    onClose();
  };

  const downloadSample = async () => {
    setSampleLoading(true);
    try {
      const file = await utils.employees.downloadImportSample.fetch();
      downloadWorkbook(file.contentBase64, file.filename);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not download the sample.');
    } finally {
      setSampleLoading(false);
    }
  };

  const load = async (file: File) => {
    const encoded = await fileToBase64(file);
    setContentBase64(encoded);
    setFileName(file.name);
    preview.mutate({ contentBase64: encoded });
    return false;
  };

  const result = preview.data;
  const ACTION: Record<EmployeeImportPreviewRow['action'], { label: string; tone: 'info' | 'brand' | 'mut' }> = {
    CREATE: { label: 'New', tone: 'info' },
    UPDATE: { label: 'Update', tone: 'brand' },
    UNCHANGED: { label: 'No change', tone: 'mut' },
  };
  const columns: ColumnsType<EmployeeImportPreviewRow> = [
    { title: 'Row', dataIndex: 'rowNumber', key: 'rowNumber', width: 60 },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      render: (_value, row) => <StatusTag status={row.action} label={ACTION[row.action].label} tone={ACTION[row.action].tone} />,
    },
    { title: 'Code', dataIndex: 'employeeCode', key: 'employeeCode', width: 110 },
    { title: 'Name', dataIndex: 'fullName', key: 'fullName' },
    { title: 'Legal Entity', dataIndex: 'legalEntityName', key: 'legalEntityName', render: (value: string | null) => value ?? '—' },
    { title: 'Department', dataIndex: 'departmentName', key: 'departmentName', render: (value: string | null, row) => <MasterName name={value} isNew={row.newDepartment} /> },
    { title: 'Designation', dataIndex: 'designationName', key: 'designationName', render: (value: string | null, row) => <MasterName name={value} isNew={row.newDesignation} /> },
    { title: 'Type', dataIndex: 'employmentTypeName', key: 'employmentTypeName', render: (value: string | null) => value ?? '—' },
    { title: 'Reimbursable', dataIndex: 'isReimbursable', key: 'isReimbursable', width: 110, render: (value: boolean) => (value ? 'Yes' : 'No') },
    {
      title: 'Monthly Salary',
      dataIndex: 'displayedSalaryAmount',
      key: 'displayedSalaryAmount',
      align: 'right',
      width: 130,
      render: (value: string | null) => formatMoney(value),
    },
    { title: 'Joining Date', dataIndex: 'joiningDate', key: 'joiningDate', width: 120, render: (value: string | null) => (value ? formatDate(value) : '—') },
    {
      title: 'Salary From',
      dataIndex: 'salaryEffectiveFrom',
      key: 'salaryEffectiveFrom',
      width: 120,
      render: (value: string | null) => (value ? formatDate(value) : '—'),
    },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 100, render: (value: string) => <StatusTag status={value} /> },
    {
      title: 'Check',
      key: 'errors',
      render: (_value, row) =>
        row.errors.length ? (
          <span className="text-negative">{row.errors.join(' ')}</span>
        ) : row.changes.length ? (
          <ul className="m-0 list-disc pl-4 text-[12px] text-ink">
            {row.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        ) : (
          <StatusTag status="OK" label={row.action === 'UNCHANGED' ? 'Same as now' : 'Ready'} tone="pos" />
        ),
    },
  ];

  return (
    <Modal
      title="Import Employees (Excel)"
      open={open}
      onCancel={close}
      width={1100}
      okText={result ? `Import: ${result.createCount} new, ${result.updateCount} update` : 'Import'}
      okButtonProps={{ disabled: !result || result.errorCount > 0 || result.createCount + result.updateCount === 0 || !contentBase64 }}
      confirmLoading={importRows.isPending}
      onOk={() => contentBase64 && importRows.mutate({ contentBase64 })}
      destroyOnHidden
    >
      <p className="mt-0 text-[12.5px] text-muted">
        Use the sample columns: employee code, full name, department, designation, employment type, reimbursable,
        monthly salary, joining date (optional), status, legal entity and salary effective from. Department, designation
        and employment type must already exist (name or code). An employee code already here updates that employee:
        filled cells change, blank cells are kept. The same salary as now is kept; a different one starts from Salary
        Effective From. A file with any invalid row imports nothing. Login access is not imported.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Upload accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" showUploadList={false} beforeUpload={(file) => load(file)}>
          <Button>Choose Excel</Button>
        </Upload>
        <Button type="link" loading={sampleLoading} onClick={() => void downloadSample()}>
          Download sample
        </Button>
        {fileName ? <span className="text-[12.5px] text-muted">{fileName}</span> : null}
      </div>
      {result && result.newDepartmentNames.length + result.newDesignationNames.length > 0 ? (
        <Alert
          type="info"
          showIcon
          className="mb-3"
          message={[
            result.newDepartmentNames.length > 0 ? `New departments: ${result.newDepartmentNames.join(', ')}.` : '',
            result.newDesignationNames.length > 0 ? `New designations: ${result.newDesignationNames.join(', ')}.` : '',
            'They are added to Masters when you import.',
          ].filter(Boolean).join(' ')}
        />
      ) : null}
      {result && result.errorCount > 0 ? (
        <Alert type="error" showIcon className="mb-3" message={`${result.errorCount} row(s) need fixing before anything can be imported.`} />
      ) : null}
      <Table
        rowKey="rowNumber"
        size="small"
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        loading={preview.isPending}
        columns={columns}
        dataSource={result?.rows ?? []}
        tableLayout="auto" scroll={{ x: true }}
        locale={{ emptyText: 'Choose an Excel file.' }}
      />
    </Modal>
  );
}

/** A department or designation, tagged New when the import will add it to Masters. */
function MasterName({ name, isNew }: { name: string | null; isNew: boolean }) {
  if (!name) return <>—</>;
  return (
    <span className="whitespace-nowrap">
      {name}
      {isNew ? <Tag color="gold" className="ml-1.5 mr-0 text-[11px]">New</Tag> : null}
    </span>
  );
}
