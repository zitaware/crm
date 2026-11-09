'use client';

import { Tooltip } from 'antd';
import { trpc } from '@/server/trpc';

/**
 * Who approves a legal entity's employee expense claims (ADR-171, ADR-182).
 * Worked out, never chosen here: users holding the approve permission whose
 * own employee record is in this legal entity, or who see every legal entity
 * (Admin). Nobody from another legal entity.
 */
export function ClaimApproversCell({ legalEntityId }: { legalEntityId: string }) {
  const approvers = trpc.employeeExpenses.listClaimApprovers.useQuery();
  const entity = approvers.data?.entities.find((e) => e.legalEntityId === legalEntityId);
  if (!approvers.data) return <span className="text-muted">…</span>;
  const names = entity?.approvers.map((a) => a.name).join(', ');
  return (
    <Tooltip title="Users with the approve permission whose employee record is in this legal entity, or who see every legal entity (Admin). Set an employee's legal entity in Employees.">
      {names ? <span className="text-[12.5px] text-ink">{names}</span> : <span className="text-[12.5px] text-warning">No approver yet</span>}
    </Tooltip>
  );
}
