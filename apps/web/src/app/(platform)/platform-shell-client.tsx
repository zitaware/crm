'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, PageHeader } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { formatDate, formatMoney } from '@/lib/format';
import type { ServerSession } from '@/server/session';
import { firstAllowedPath, holdsPermission, permissionForPath } from './route-access';
import { useNoEnterSubmit } from '@/lib/no-enter-submit';
import { GlobalSearch } from '@/components/global-search';
import { useBrandFavicon } from '@/lib/brand-favicon';

export function PlatformShellClient({ session, children }: { session: ServerSession; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const utils = trpc.useUtils();
  // Inside the app, Enter in a field never submits a form (sign-in pages keep it).
  useNoEnterSubmit();

  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await utils.auth.me.reset();
      router.push('/login');
      router.refresh();
    },
  });

  // Entity-wise data (ADR-172): without a legal entity on their employee
  // record, a user who is not Admin sees no entity's data, and is told why.
  const me = trpc.auth.me.useQuery();
  const noEntity = me.data?.legalEntityAccess === 'NONE';
  // ADR-174: an Admin viewing as this user sees who, and a way back.
  const impersonatedBy = me.data?.impersonatedBy ?? null;
  const stopImpersonation = trpc.auth.stopImpersonation.useMutation({
    onSuccess: (result) => window.location.assign(result.status === 'ok' ? '/users' : '/login'),
  });

  const canSeePaymentAlerts = session.permissions.includes('payment_alert.read');
  // White labelling: the sidebar shows the user's own legal entity, with its logo once loaded.
  const brandLogo = trpc.auth.brandLogo.useQuery(undefined, { enabled: !!session.brandName && session.brandHasLogo, staleTime: Infinity });
  const brand = session.brandName
    ? { name: session.brandName, logoSrc: brandLogo.data ? `data:${brandLogo.data.contentType};base64,${brandLogo.data.dataBase64}` : null }
    : undefined;
  useBrandFavicon(brand, session.brandHasLogo && brandLogo.isPending);

  const headerAlerts = trpc.paymentAlerts.getHeaderSummary.useQuery(undefined, {
    enabled: canSeePaymentAlerts,
    refetchInterval: 60_000,
  });

  const notificationItems = (headerAlerts.data?.items ?? []).map((item) => ({
    id: item.id,
    status: item.derivedLabel,
    label: item.title,
    sublabel: `${item.projectName} · Due ${formatDate(item.dueDate)} · ${formatMoney(item.amount)}`,
    onClick: () => router.push(`/projects/${item.projectId}?tab=payment-alert`),
  }));
  const totalOpenCount = (headerAlerts.data?.overdueCount ?? 0) + (headerAlerts.data?.dueCount ?? 0);

  const required = permissionForPath(pathname);
  const allowed = holdsPermission(session.permissions, required);
  const home = firstAllowedPath(session.permissions);
  const redirectingHome = pathname === '/' && !holdsPermission(session.permissions, 'dashboard.read') && home !== null;

  useEffect(() => {
    if (redirectingHome && home) {
      router.replace(home);
    }
  }, [redirectingHome, home, router]);

  return (
    <AppShell
      session={session}
      brand={brand}
      pathname={pathname}
      // No page name in the top bar: each page's own title says where you are.
      breadcrumb={null}
      onNavigate={(path) => router.push(path)}
      onLogout={() => logout.mutate()}
      hasUnreadNotifications={totalOpenCount > 0}
      notificationItems={notificationItems}
      notificationOverflowCount={Math.max(0, totalOpenCount - notificationItems.length)}
      search={<GlobalSearch />}
    >
      {impersonatedBy ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-ui border border-brand bg-brand-soft px-4 py-3 text-[13px] text-ink">
          <span>
            <b>You are logged in as {session.displayName ?? 'another user'}</b>, by {impersonatedBy.displayName}. Everything you do here is recorded under your name too.
          </span>
          <button
            type="button"
            className="rounded-ui border border-ink bg-surface px-3 py-1 font-semibold text-ink hover:bg-ink hover:text-white"
            disabled={stopImpersonation.isPending}
            onClick={() => stopImpersonation.mutate()}
          >
            Return to my login
          </button>
        </div>
      ) : null}
      {noEntity ? (
        <div className="mb-4 rounded-ui border border-warning bg-warning-soft px-4 py-3 text-[13px] text-ink">
          <b>No legal entity is set on your employee record,</b> so projects, invoices, payments, expenses and reports show nothing for you. Ask an
          Admin to set your legal entity in Employees.
        </div>
      ) : null}
      {allowed ? (
        children
      ) : redirectingHome ? null : (
        <PageHeader
          title="This screen is not on your role"
          description="The menu shows the screens this login can open. Ask an administrator if this job needs more access."
        />
      )}
    </AppShell>
  );
}
