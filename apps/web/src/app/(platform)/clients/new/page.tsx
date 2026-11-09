'use client';

import { App, Button } from 'antd';
import { useRouter } from 'next/navigation';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { ClientFormBody } from '../shared';
import type { ClientCoreFormValues } from '../shared';
import { EMPTY_CLIENT, clientCreateInput } from '@/components/client-select';

export default function NewClientPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const utils = trpc.useUtils();
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const createMutation = trpc.clients.create.useMutation({
    onSuccess: async (client) => {
      message.success('Client added.');
      await utils.clients.list.invalidate();
      clearDraft.mutate({ formKey: 'client:new' });
      router.push(`/clients/${client.id}`);
    },
    onError: (error) => message.error(error.message),
  });

  const handleSubmit = (values: ClientCoreFormValues) => {
    createMutation.mutate(clientCreateInput(values));
  };

  return (
    <div>
      <PageHeader
        title="Add Client"
        description="Register a new client — a company, an individual or any other organisation."
        actions={<Button onClick={() => router.push('/clients')}>Back to list</Button>}
      />
      <UiCard>
        <ClientFormBody
          mode="create"
          formKey="client:new"
          initial={EMPTY_CLIENT}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/clients')}
          submitting={createMutation.isPending}
        />
      </UiCard>
    </div>
  );
}
