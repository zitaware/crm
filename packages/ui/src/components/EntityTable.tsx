import { Table } from 'antd';
import type { TableProps } from 'antd';
import type { ReactNode } from 'react';

export interface EntityTableProps<RecordType extends object> extends Omit<TableProps<RecordType>, 'pagination'> {
  /** A stable domain id field, per docs/15 §13.3 ("use a stable domain ID as rowKey"). */
  rowKey: NonNullable<TableProps<RecordType>['rowKey']>;
  loading?: boolean;
  errorMessage?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number, pageSize: number) => void;
}

/**
 * Shared AntD Table wrapper — docs/15-ui-design-system.md §13.1/§13.3.
 * Server-backed sorting/pagination only; this component never sorts or
 * paginates client-side data itself.
 */
export function EntityTable<RecordType extends object>({
  loading = false,
  errorMessage,
  emptyTitle = 'No records found',
  emptyDescription,
  page,
  pageSize,
  total,
  onPageChange,
  locale,
  scroll,
  tableLayout,
  columns,
  ...tableProps
}: EntityTableProps<RecordType>) {
  if (errorMessage) {
    return (
      <div className="p-[50px_20px] text-center text-muted" role="alert">
        <h4 className="mb-1 text-[15px] text-text">Something went wrong</h4>
        <p className="text-[13px]">{errorMessage}</p>
      </div>
    );
  }

  // Every row-actions column in this codebase is keyed 'actions' by
  // convention — pinning it to the right here, once, means a horizontally
  // scrolling table (see the `scroll` default below) never scrolls the
  // View/Edit/Delete buttons out of reach, without every page having to
  // remember `fixed: 'right'` itself. A caller's own `fixed` still wins.
  const resolvedColumns = columns?.map((column) =>
    column.key === 'actions' && column.fixed === undefined ? { ...column, fixed: 'right' as const } : column,
  );

  return (
    <Table<RecordType>
      {...tableProps}
      {...(resolvedColumns ? { columns: resolvedColumns } : {})}
      loading={loading}
      // The table fits its card and long text wraps onto the next line. It
      // scrolls sideways only when the columns cannot fit even wrapped, as
      // on a phone — docs/15-ui-design-system.md §19 "dense tables scroll
      // horizontally". `max-content` was used before, but it keeps every
      // cell on one line, so one long title widened the whole table and
      // made it scroll on a desktop too. Callers may still pass their own
      // `scroll` (e.g. a fixed-height vertical-scroll table) or layout.
      tableLayout={tableLayout ?? 'auto'}
      scroll={scroll ?? { x: true }}
      locale={{
        emptyText: (
          <div className="py-[50px_20px] text-center text-muted">
            <h4 className="mb-1 text-[15px] text-text">{emptyTitle}</h4>
            {emptyDescription ? <p className="text-[13px]">{emptyDescription}</p> : null}
          </div>
        ),
        ...locale,
      }}
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: onPageChange,
        showTotal: (totalCount, range) => `Showing ${range[0]}–${range[1]} of ${totalCount}`,
      }}
    />
  );
}
