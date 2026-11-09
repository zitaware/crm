'use client';

import { Dropdown } from 'antd';
import type { ReactNode } from 'react';
import { BellIcon, ChevronDownIcon, MenuIcon } from './icons';
import { StatusTag } from './StatusTag';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export interface TopbarNotificationItem {
  id: string;
  /** Canonical status value (e.g. 'OVERDUE' | 'DUE') — rendered via StatusTag. */
  status: string;
  label: string;
  sublabel: string;
  onClick: () => void;
}

export interface TopbarProps {
  breadcrumb: ReactNode;
  displayName: string | null;
  roleLabel?: string;
  onLogout: () => void;
  onOpenMobileNav: () => void;
  hasUnreadNotifications?: boolean | undefined;
  notificationItems?: TopbarNotificationItem[] | undefined;
  /** True total minus notificationItems.length — shown as a "+N more" footer when truthy. */
  notificationOverflowCount?: number | undefined;
  /** The search box, supplied by the app (it needs the app's data); none shows no box. */
  search?: ReactNode;
}

/** Top bar — docs/15-ui-design-system.md §8.3. */
export function Topbar({
  breadcrumb,
  displayName,
  roleLabel,
  onLogout,
  onOpenMobileNav,
  hasUnreadNotifications,
  notificationItems,
  notificationOverflowCount,
  search,
}: TopbarProps) {
  const initials = (displayName ?? '?')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-20 flex h-[56px] items-center gap-4 border-b border-ui bg-surface px-[22px]">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation menu"
        className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-ui border border-ui text-muted hover:bg-app min-[980px]:hidden ${FOCUS_RING}`}
      >
        <MenuIcon className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-[7px] text-[12.5px] text-muted">{breadcrumb}</div>

      <div className="ml-auto hidden w-[340px] min-[980px]:block">{search}</div>

      <Dropdown
        trigger={['click']}
        popupRender={() => (
          <div className="w-[320px] rounded-ui border border-ui bg-surface p-2 shadow-lg">
            {!notificationItems || notificationItems.length === 0 ? (
              <p className="p-3 text-[12.5px] text-muted">No open alerts.</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {notificationItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={item.onClick}
                        className={`flex w-full flex-col items-start gap-1 rounded-ui p-2 text-left hover:bg-app ${FOCUS_RING}`}
                      >
                        <span className="flex items-center gap-2">
                          <StatusTag status={item.status} />
                          <span className="text-[12.5px] font-medium text-ink">{item.label}</span>
                        </span>
                        <span className="text-[11.5px] text-muted">{item.sublabel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {notificationOverflowCount ? (
                  <p className="mt-1 border-t border-ui p-2 text-[11.5px] text-muted">
                    +{notificationOverflowCount} more — open a project&apos;s Payment Alert tab to see all.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}
      >
        <button
          type="button"
          aria-label={hasUnreadNotifications ? 'Alerts (unread)' : 'Alerts'}
          className={`relative grid h-[34px] w-[34px] shrink-0 place-items-center rounded-ui border border-ui text-muted hover:bg-app hover:text-text ${FOCUS_RING}`}
        >
          {hasUnreadNotifications ? (
            <span aria-hidden="true" className="absolute right-[7px] top-[6px] h-[7px] w-[7px] rounded-full bg-negative ring-2 ring-surface" />
          ) : null}
          <BellIcon className="h-4 w-4" />
        </button>
      </Dropdown>

      <Dropdown
        menu={{
          items: [{ key: 'logout', label: 'Sign out', onClick: onLogout }],
        }}
        trigger={['click']}
      >
        <button
          type="button"
          className={`flex shrink-0 items-center gap-[9px] rounded-ui py-1 pl-[6px] pr-2 hover:bg-app ${FOCUS_RING}`}
          aria-label="User menu"
          title={displayName ?? undefined}
        >
          {/* A plain badge: Ant Design's Avatar paints its own grey over the brand colours. */}
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft font-display text-[12px] font-bold tracking-[.02em] text-brand ring-1 ring-brand/25"
          >
            {initials}
          </span>
          <span className="hidden min-w-0 text-left leading-[1.2] min-[980px]:block">
            <span className="block max-w-[180px] truncate whitespace-nowrap text-[13px] font-semibold text-text">{displayName ?? '—'}</span>
            {roleLabel ? <span className="block max-w-[180px] truncate whitespace-nowrap text-[11px] text-muted">{roleLabel}</span> : null}
          </span>
          <ChevronDownIcon aria-hidden="true" className="hidden h-[14px] w-[14px] shrink-0 text-muted-2 min-[980px]:block" />
        </button>
      </Dropdown>
    </header>
  );
}
