'use client';

import { Suspense } from 'react';
import { App, Button } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { LeadFormBody } from '../shared';
import type { LeadCoreFormValues } from '../shared';

function NewLeadForm() {
  const { message } = App.useApp();
  const router = useRouter();
  const clientId = useSearchParams().get('clientId') ?? '';
  const utils = trpc.useUtils();
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const createMutation = trpc.leads.create.useMutation({
    onSuccess: async (lead) => {
      message.success('Saved.');
      await utils.leads.list.invalidate();
      clearDraft.mutate({ formKey: 'lead:new' });
      router.push(lead.stage === 'TENDER_WON' ? `/leads/${lead.id}?createProject=1` : `/leads/${lead.id}`);
    },
    onError: (error) => message.error(error.message),
  });

  const handleSubmit = (values: LeadCoreFormValues) => {
    createMutation.mutate({
      clientId: values.clientId,
      leadTypeId: values.leadTypeId,
      leadSourceId: values.leadSourceId,
      introducerId: values.introducerId,
      title: values.title,
      description: values.description,
      stage: values.stage as 'PROPOSAL_SENT' | 'PRESENTATION_DONE' | 'SOW_PREPARATION' | 'TENDER_LIVE' | 'TENDER_FILLED' | 'TENDER_WON' | 'TENDER_LOST',
      estimatedValue: values.estimatedValue,
      leadDate: values.leadDate,
      expectedCloseDate: values.expectedCloseDate,
      expectedTenderDate: values.expectedTenderDate,
      tenderNumber: values.tenderNumber,
      tenderDate: values.tenderDate,
      submissionDeadline: values.submissionDeadline,
      reminderOffset: values.reminderOffset as 'NONE' | 'ONE_DAY' | 'THREE_DAYS' | 'ONE_WEEK' | undefined,
      internalNote: values.internalNote,
    });
  };

  return (
    <div>
      <PageHeader title="Add Lead" description="Record a new lead. Mark Won to create the project." actions={<Button onClick={() => router.push('/leads')}>Back to list</Button>} />
      <UiCard>
        <LeadFormBody
          mode="create"
          formKey="lead:new"
          initial={{
            clientId,
            leadTypeId: '',
            leadSourceId: '',
            introducerId: undefined,
            assignedToEmployeeId: undefined,
            title: '',
            description: undefined,
            stage: 'PROPOSAL_SENT',
            estimatedValue: undefined,
            leadDate: new Date().toISOString().slice(0, 10),
            expectedCloseDate: undefined,
            expectedTenderDate: undefined,
            tenderNumber: undefined,
            tenderDate: undefined,
            submissionDeadline: undefined,
            reminderOffset: undefined,
            internalNote: undefined,
          }}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/leads')}
          submitting={createMutation.isPending}
        />
      </UiCard>
    </div>
  );
}

export default function NewLeadPage() {
  return (
    <Suspense fallback={null}>
      <NewLeadForm />
    </Suspense>
  );
}
