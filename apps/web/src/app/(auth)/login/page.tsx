'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Form, Input } from 'antd';
import { trpc } from '@/server/trpc';
import { sanitizeNextPath } from '@/lib/next-path';

interface LoginFormValues {
  email: string;
  password: string;
}

function LoginForm() {
  const router = useRouter();
  const next = sanitizeNextPath(useSearchParams().get('next'));
  const [form] = Form.useForm<LoginFormValues>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation({
    onSuccess: () => {
      router.push(next);
      router.refresh();
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  return (
    <>
      <h1 className="mb-1 font-display text-[21px] font-bold leading-[1.15] text-ink">Sign in</h1>
      <p className="mb-5 text-[13px] text-muted">Enter your credentials to access your account.</p>

      {errorMessage ? (
        <Alert className="mb-4" type="error" message={errorMessage} showIcon closable onClose={() => setErrorMessage(null)} />
      ) : null}

      <Form<LoginFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => {
          setErrorMessage(null);
          login.mutate(values);
        }}
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

        <Form.Item
          label="Password"
          name="password"
          rules={[{ required: true, message: 'Password is required.' }]}
>
          <Input.Password autoComplete="current-password" placeholder="Password" />
        </Form.Item>

        <div className="mb-4 text-right">
          <Link href="/forgot-password" className="text-[12.5px] text-muted hover:text-brand">
            Forgot password?
          </Link>
        </div>

        <Button type="primary" htmlType="submit" block loading={login.isPending}>
          Sign in
        </Button>
      </Form>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
