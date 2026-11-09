'use client';

// Ant Design v5 targets React 16–18 and logs a "[antd: compatible]" console
// warning under this project's React 19. This official patch (antd's own
// recommended fix — https://ant.design/docs/react/v5-for-19) calls antd's
// unstableSetRender so its static methods (message/notification/Modal.*)
// render correctly under React 19, and silences the warning. It is a pure
// side-effect import and must run client-side before any antd component
// mounts, hence this outermost client provider rather than the server-side
// root layout.
import '@ant-design/v5-patch-for-react-19';
import { useState } from 'react';
import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { httpBatchLink, TRPCClientError } from '@trpc/client';
import type { AppErrorCode } from '@zitaware/contracts';
import { trpc } from './trpc';
import { noteFormDraftCleared } from '@/components/form-draft';
import { PUBLIC_AUTH_PATHS } from '@/lib/next-path';
import { fetchWithSessionRefresh } from '@/lib/session-tokens';

const API_PUBLIC_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// fetchWithSessionRefresh renews the access token from the refresh cookie
// once, then retries. This redirect runs only when that renewal fails
// (refresh token expired, revoked, or missing). A wrong-password attempt
// on /login is also UNAUTHENTICATED and must not trigger this.
function redirectOnSessionExpiry(error: unknown) {
  if (!(error instanceof TRPCClientError)) return;
  const appErrorCode = (error.data as { appErrorCode?: AppErrorCode } | undefined)?.appErrorCode;
  if (appErrorCode !== 'UNAUTHENTICATED') return;
  if (PUBLIC_AUTH_PATHS.some((path) => window.location.pathname.startsWith(path))) return;

  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          // Default is 0 — every remount/tab-refocus refetches even
          // unchanged data. Every mutation in this codebase already
          // explicitly calls `utils.x.invalidate()` on success, so a
          // real write is never masked by this; this only cuts
          // redundant refetches of data nothing has changed.
          staleTime: 30_000,
        },
      },
      queryCache: new QueryCache({ onError: redirectOnSessionExpiry }),
      mutationCache: new MutationCache({
        onError: redirectOnSessionExpiry,
        onSuccess: (_data, variables, _context, mutation) => {
          const path = mutation.options.mutationKey?.[0];
          if (!Array.isArray(path) || path[0] !== 'formDrafts' || path[1] !== 'clear') return;
          if (!variables || typeof variables !== 'object' || !('formKey' in variables) || typeof variables.formKey !== 'string') return;
          noteFormDraftCleared(client, variables.formKey);
        },
      }),
    });
    return client;
  });
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${API_PUBLIC_URL}/trpc`,
          // The API sets HttpOnly session cookies on a different origin/port
          // (apps/api on :4000 vs apps/web on :3000) — without this, the
          // browser never sends or stores them and every authenticated call
          // fails silently.
          fetch(url, options) {
            return fetchWithSessionRefresh(url, options);
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
