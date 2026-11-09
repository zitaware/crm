'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Form, Input } from 'antd';
import { trpc } from '@/server/trpc';

interface AcceptInviteFormValues {
  password: string;
  confirmPassword: string;
}

function AcceptInviteForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const acceptInvite = trpc.auth.acceptInvite.useMutation({
    onSuccess: () => {
      router.push('/');
      router.refresh();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  if (!token) {
    return (
      <Alert
        type="error"
        showIcon
        message="Invalid invitation link"
        description="This invitation link is missing its token. Ask an administrator to re-invite you."
      />
    );
  }

  return (
    <>
      <h1 className="mb-1 font-display text-[21px] font-bold leading-[1.15] text-ink">Accept invitation</h1>
      <p className="mb-5 text-[13px] text-muted">Set a password to activate your account.</p>

      {errorMessage ? (
        <Alert className="mb-4" type="error" message={errorMessage} showIcon closable onClose={() => setErrorMessage(null)} />
      ) : null}

      <Form<AcceptInviteFormValues>
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => {
          setErrorMessage(null);
          acceptInvite.mutate({ token, password: values.password });
        }}
      >
        <Form.Item
          label="Password"
          name="password"
          rules={[
            { required: true, message: 'Password is required.' },
            { min: 8, message: 'Password must be at least 8 characters.' },
          ]}
>
          <Input.Password autoComplete="new-password" autoFocus placeholder="Choose a password" />
        </Form.Item>

        <Form.Item
          label="Confirm password"
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Please confirm your password.' },
            ({ getFieldValue }) => ({
              validator(_rule, value: string) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Passwords do not match.'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder="Confirm password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={acceptInvite.isPending}>
          Activate account
        </Button>
      </Form>
    </>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
