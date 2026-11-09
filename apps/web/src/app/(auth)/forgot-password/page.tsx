'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Form, Input } from 'antd';
import { trpc } from '@/server/trpc';

interface ForgotPasswordFormValues {
  email: string;
}

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);
  const requestReset = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  if (submitted) {
    return (
      <>
        <h1 className="mb-1 font-display text-[21px] font-bold leading-[1.15] text-ink">Check your email</h1>
        <p className="mb-5 text-[13px] text-muted">
          If an account exists for that email address, we&apos;ve sent a link to reset your password.
        </p>
        <Link href="/login">
          <Button block>Back to sign in</Button>
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1 font-display text-[21px] font-bold leading-[1.15] text-ink">Forgot password</h1>
      <p className="mb-5 text-[13px] text-muted">
        Enter your account email and we&apos;ll send you a link to reset your password.
      </p>

      <Form<ForgotPasswordFormValues>
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => requestReset.mutate(values)}
      >
        <Form.Item
          label="Email"
          name="email"
          rules={[
            { required: true, message: 'Email is required.' },
            { type: 'email', message: 'Enter a valid email address.' },
          ]}
>
          <Input autoComplete="email" autoFocus placeholder="you@zitaware.in" />
        </Form.Item>

        <Button type="primary" htmlType="submit" block loading={requestReset.isPending}>
          Send reset link
        </Button>
      </Form>

      <div className="mt-4 text-center">
        <Link href="/login" className="text-[12.5px] text-muted hover:text-brand">
          Back to sign in
        </Link>
      </div>

      {requestReset.isError ? (
        <Alert className="mt-4" type="error" message={requestReset.error.message} showIcon />
      ) : null}
    </>
  );
}
