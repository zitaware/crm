import { redirect } from 'next/navigation';
import { getServerSession } from '@/server/session';
import { PlatformShellClient } from './platform-shell-client';

/**
 * Authenticated shell for every Phase 2B platform screen. The session
 * check runs on the server, before any protected markup is produced —
 * see apps/web/src/server/session.ts for why this is a real guard and not
 * a client-side redirect-on-error (docs/04-screen-contracts.md §5.2).
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) {
    redirect('/login');
  }

  return <PlatformShellClient session={session}>{children}</PlatformShellClient>;
}
