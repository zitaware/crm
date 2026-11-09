'use client';

import { Suspense } from 'react';
import { App, Button } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { EMPTY_PROJECT, projectCreateInput, type ProjectCoreFormValues } from '@/components/project-select';
import { ProjectFormBody } from '../shared';

function NewProjectForm() {
  const { message } = App.useApp();
  const router = useRouter();
  const clientId = useSearchParams().get('clientId') ?? '';
  const utils = trpc.useUtils();
  const clearDraft = trpc.formDrafts.clear.useMutation();

  const createMutation = trpc.projects.create.useMutation({
    onSuccess: async (project) => {
      message.success('Project added.');
      await utils.projects.list.invalidate();
      clearDraft.mutate({ formKey: 'project:new' });
      router.push(`/projects/${project.id}`);
    },
    onError: (error) => message.error(error.message),
  });

  const handleSubmit = (values: ProjectCoreFormValues) => {
    createMutation.mutate(projectCreateInput(values));
  };

  return (
    <div>
      <PageHeader title="Add Project" description="Set up a new project in execution." actions={<Button onClick={() => router.push('/projects')}>Back to list</Button>} />
      <UiCard>
        <ProjectFormBody
          mode="create"
          formKey="project:new"
          initial={{ ...EMPTY_PROJECT, clientId }}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/projects')}
          submitting={createMutation.isPending}
        />
      </UiCard>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={null}>
      <NewProjectForm />
    </Suspense>
  );
}
