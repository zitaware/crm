'use client';

import { Alert, Button } from 'antd';

/**
 * "Here is why this is empty, and here is the one thing to do about it."
 *
 * A zero that means *nothing happened* and a zero that means *you haven't
 * finished setting up* look identical otherwise, and the difference is the
 * whole question the user is asking. Every guided empty state in the app
 * should read the same, so this generalises the one place that already did
 * it well (the Reopen alert in employee-allocations).
 *
 * `action` is optional: some prerequisites are genuinely someone else's job,
 * and a button that leads nowhere useful is worse than none.
 */
export function NextStep({
  tone = 'info',
  title,
  detail,
  actionLabel,
  onAction,
}: {
  tone?: 'info' | 'warning' | 'success';
  title: string;
  detail?: string | undefined;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
}) {
  return (
    <Alert
      type={tone}
      showIcon
      message={title}
      {...(detail ? { description: detail } : {})}
      {...(actionLabel && onAction
        ? {
            action: (
              <Button size="small" type="primary" onClick={onAction}>
                {actionLabel}
              </Button>
            ),
          }
        : {})}
    />
  );
}
