'use client';

import { Drawer } from 'antd';
import { useState, type ReactNode } from 'react';
import { SidebarNavigation, type SidebarBrand } from './SidebarNavigation';
import { Topbar, type TopbarNotificationItem } from './Topbar';

export interface AppShellSession {
  displayName: string | null;
  organizationName: string | null;
  permissions: string[];
}

export interface AppShellProps {
  session: AppShellSession;
  pathname: string;
  breadcrumb: ReactNode;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: ReactNode;
  hasUnreadNotifications?: boolean | undefined;
  notificationItems?: TopbarNotificationItem[] | undefined;
  notificationOverflowCount?: number | undefined;
  /** The top bar's search box. */
  search?: ReactNode;
  /** The user's own legal entity in the sidebar's brand area, in place of the organization. */
  brand?: SidebarBrand | undefined;
}

/**
 * Authenticated application frame — docs/15-ui-design-system.md §8,
 * derived from references/ui/html/01-platform/shell.html. Tailwind owns
 * the grid/frame (§7.2); Ant Design owns the interactive chrome inside it
 * (§7.1) — Menu, Drawer, Dropdown, Avatar, Input.
 *
 * Above 980px: static `252px` sidebar column. At/below 980px: sidebar
 * becomes an off-canvas AntD Drawer opened from the Topbar's menu button
 * (docs/15 §19) — AntD's Drawer traps focus and returns it to the trigger
 * on close, satisfying §20's modal/drawer focus-trap requirement.
 */
export function AppShell({
  session,
  pathname,
  breadcrumb,
  onNavigate,
  onLogout,
  children,
  hasUnreadNotifications,
  notificationItems,
  notificationOverflowCount,
  search,
  brand,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleNavigate = (path: string) => {
    setMobileNavOpen(false);
    onNavigate(path);
  };

  return (
    <div
      className={`grid min-h-screen ${sidebarCollapsed ? 'min-[980px]:grid-cols-[72px_1fr]' : 'min-[980px]:grid-cols-[252px_1fr]'}`}
    >
      {/* Deliberately NOT scrollable itself: the nav inside owns the scroll,
          so the brand header stays pinned and only one scrollbar exists. */}
      <aside className="sticky top-0 hidden h-screen overflow-hidden min-[980px]:block">
        <SidebarNavigation
          organizationName={session.organizationName}
          brand={brand}
          permissions={session.permissions}
          pathname={pathname}
          onNavigate={handleNavigate}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
      </aside>

      <Drawer
        placement="left"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        closable={false}
        width={252}
        styles={{ body: { padding: 0 } }}
        className="min-[980px]:hidden"
      >
        <SidebarNavigation
          organizationName={session.organizationName}
          brand={brand}
          permissions={session.permissions}
          pathname={pathname}
          onNavigate={handleNavigate}
        />
      </Drawer>

      <div className="flex min-w-0 flex-col">
        <Topbar
          breadcrumb={breadcrumb}
          displayName={session.displayName}
          onLogout={onLogout}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          hasUnreadNotifications={hasUnreadNotifications}
          notificationItems={notificationItems}
          notificationOverflowCount={notificationOverflowCount}
          search={search}
        />
        <main className="w-full max-w-[1500px] p-[22px]">{children}</main>
      </div>
    </div>
  );
}
