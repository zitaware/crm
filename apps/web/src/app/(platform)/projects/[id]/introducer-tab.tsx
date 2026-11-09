'use client';

import { Alert } from 'antd';
import { useRouter } from 'next/navigation';
import { trpc } from '@/server/trpc';
import { NextStep } from '@/components/next-step';
import { AgreementsTab } from '../../introducer-fees/agreements-tab';

/**
 * Introducer commission on this project (ADR-097).
 *
 * Reuses the global AgreementsTab in project scope rather than duplicating
 * the list, the Add drawer and the Accrue modal — one screen, two mount
 * points, exactly the SecurityInstrumentTab pattern.
 */
export function IntroducerSection({ projectId }: { projectId: string }) {
  const router = useRouter();
  const permissions = trpc.auth.me.useQuery().data?.permissions ?? [];
  const canCreate = permissions.includes('introducer_fee.create');

  const project = trpc.projects.getDetail.useQuery({ id: projectId });
  const agreements = trpc.introducerFees.listAgreements.useQuery({ includeInactive: true, projectId });

  const projectIntroducerId = project.data?.introducerId ?? null;
  const rows = agreements.data?.rows ?? [];

  // The project names an introducer but no agreement exists for them — the
  // commercial relationship is recorded on the project while the money side
  // never got set up. Worth surfacing, since it is the exact gap ADR-097
  // was written to close.
  const missingAgreement =
    projectIntroducerId !== null && rows.length === 0
      ? (project.data?.introducerName ?? 'This project\u2019s introducer')
      : null;

  // An agreement names someone other than the project's own introducer.
  // Legitimate (several introducers can share a project) but worth flagging.
  const mismatched = projectIntroducerId
    ? rows.filter((r) => r.introducerId !== projectIntroducerId).map((r) => r.introducerName)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {missingAgreement ? (
        <NextStep
          title={`${missingAgreement} is this project's introducer, but has no commission agreement yet`}
          detail="Record what they are entitled to. Nothing is posted until commission is accrued."
          actionLabel="Introducer master"
          onAction={() => router.push('/introducers')}
        />
      ) : null}

      {mismatched.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="An agreement names a different introducer than the project does"
          description={`${[...new Set(mismatched)].join(', ')} ${mismatched.length === 1 ? 'has' : 'have'} an agreement here, but the project itself names ${project.data?.introducerName ?? 'someone else'}. That is allowed — several introducers can share a project — but worth confirming.`}
        />
      ) : null}

      <AgreementsTab canCreate={canCreate} projectId={projectId} />
    </div>
  );
}
