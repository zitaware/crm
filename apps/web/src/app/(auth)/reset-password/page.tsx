'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Form, Input } from 'antd';
import { trpc } from '@/server/trpc';

interface ResetPasswordFormValues {
  newPassword: string;
  confirmPassword: string;
}

function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [submitted, setSubmitted] = useState(false);
  const completeReset = trpc.auth.completePasswordReset.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  if (!token) {
    return (
      <Alert
        type="error"
        showIcon
        message="Invalid reset link"
        description="This password reset link is missing its token. Request a new one from the forgot-password page."
      />
    );
  }

  if (submitted) {
    return (
      <>
        <h1 className="mb-1 font-display text-[21px] font-bold leading-[1.15] text-ink">Password updated</h1>
        <p className="mb-5 text-[13px] text-muted">
          Your password has been reset and every active session has been signed out. Sign in with your new password.
        </p>
        <Link href="/login">
          <Button type="primary" block>
            Go to sign in
          </Button>
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 font-display text-[21px] font-bold leading-[1.15] text-ink">Reset password</h1>
      <p className="mb-5 text-[13px] text-muted">Choose a new password for your account.</p>

      <Form<ResetPasswordFormValues>
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => completeReset.mutate({ token, newPassword: values.newPassword })}
      >
        <Form.Item
          label="New password"
          name="newPassword"
          rules={[
            { required: true, message: 'New password is required.' },
            { min: 8, message: 'Password must be at least 8 characters.' },
          ]}
>
          <Input.Password autoComplete="new-password" autoFocus placeholder="New password" />
        </Form.Item>

        <Form.Item
          label="Confirm new password"
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Please confirm your new password.' },
            ({ getFieldValue }) => ({
              validator(_rule, value: string) {
                if (!value || getFieldValue('newPassword') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('Passwords do not match.'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder="Confirm new password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={completeReset.isPending}>
          Reset password
        </Button>
      </Form>

      {completeReset.isError ? (
        <Alert className="mt-4" type="error" message={completeReset.error.message} showIcon />
      ) : null}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
