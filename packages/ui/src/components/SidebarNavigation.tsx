'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Menu } from 'antd';
import type { MenuProps } from 'antd';
import { ChevronDownIcon, ChevronLeftIcon } from './icons';
import { NAV_ITEMS, type NavItem } from './nav-items';

/** White labelling: the user's own legal entity, shown in place of the organization. `logoSrc` is null while it loads or when it has none. */
export interface SidebarBrand {
  name: string;
  logoSrc: string | null;
}

export interface SidebarNavigationProps {
  organizationName: string | null;
  brand?: SidebarBrand | undefined;
  permissions: string[];
  pathname: string;
  onNavigate: (path: string) => void;
  /** Icons-only rail mode. Omit both this and onToggleCollapse for a
   * caller that never collapses (e.g. the mobile off-canvas Drawer copy —
   * already an overlay the user can just close, collapsing it further
   * adds nothing). */
  collapsed?: boolean;
  /** Presence of this prop is what shows the toggle button at all. */
  onToggleCollapse?: () => void;
}

/** "Concentric IT Services Private Limited" → "CI": company words like Private and Limited are skipped. */
function brandInitials(name: string): string {
  const words = name
    .replace(/\b(private|pvt|limited|ltd|llp)\b\.?/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.map((word) => word.charAt(0)).slice(0, 2).join('') || '?').toUpperCase();
}

const BRAND_NAME_MAX_PX = 15;
const BRAND_NAME_MIN_PX = 12;

/**
 * The brand name stays on one line (ADR-191): the font steps down from 15px
 * until the name fits, to a 12px floor. Only a name too long even at 12px is
 * cut with an ellipsis, and its full text is then in the tooltip.
 */
function FittedBrandName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(BRAND_NAME_MAX_PX);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = BRAND_NAME_MAX_PX;
    el.style.fontSize = `${size}px`;
    while (el.scrollWidth > el.clientWidth && size > BRAND_NAME_MIN_PX) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
    setFontSize(size);
    setClipped(el.scrollWidth > el.clientWidth);
  }, [name]);
  return (
    <span
      ref={ref}
      className="block overflow-hidden text-ellipsis whitespace-nowrap"
      style={{ fontSize }}
      title={clipped ? name : undefined}
    >
      {name}
    </span>
  );
}

function toPanelId(group: string): string {
  return `nav-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function toMenuItems(items: NavItem[]): NonNullable<MenuProps['items']> {
  return items.map((item) => ({ key: item.path, icon: <item.icon />, label: item.label }));
}

/**
 * Brand area + permission-filtered navigation menu — docs/15-ui-design-system.md
 * §8.2. Built from the centralized NAV_ITEMS registry; never lists a
 * prototype-only route the user doesn't hold the permission for.
 *
 * Each group is independently expandable/collapsible (not a strict
 * single-open accordion — several sections can stay open at once, since
 * that's the more usable pattern for a navigation rail you don't want
 * fighting your own clicks). All groups start expanded, matching the
 * previous always-visible behavior; whichever group holds the current
 * route is nudged open automatically on navigation, without permanently
 * locking it — the user can still collapse it again afterward. Only the
 * expanded (non-rail) sidebar gets accordion headers; icon-only rail mode
 * has no room for a label + chevron and keeps its existing flat rendering.
 */
export function SidebarNavigation({
  organizationName,
  brand,
  permissions,
  pathname,
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: SidebarNavigationProps) {
  const permissionSet = new Set(permissions);
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.hidden) return false;
    if (item.permission === null) return true;
    if (typeof item.permission === 'string') return permissionSet.has(item.permission);
    return item.permission.some((key) => permissionSet.has(key));
  });

  const ungroupedItems: NavItem[] = [];
  const groupOrder: string[] = [];
  const groupedItems = new Map<string, NavItem[]>();
  for (const item of visibleItems) {
    if (item.group === null) {
      ungroupedItems.push(item);
      continue;
    }
    let bucket = groupedItems.get(item.group);
    if (!bucket) {
      bucket = [];
      groupedItems.set(item.group, bucket);
      groupOrder.push(item.group);
    }
    bucket.push(item);
  }

  const selectedKey =
    visibleItems.find((item) => (item.path === '/' ? pathname === '/' : pathname.startsWith(item.path)))?.path ?? '/';
  const selectedGroup = visibleItems.find((item) => item.path === selectedKey)?.group ?? null;

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(groupOrder));

  useEffect(() => {
    if (!selectedGroup) return;
    setOpenGroups((prev) => (prev.has(selectedGroup) ? prev : new Set(prev).add(selectedGroup)));
  }, [selectedGroup]);

  const toggleGroup = (group: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const menuProps = {
    theme: 'dark' as const,
    mode: 'inline' as const,
    selectedKeys: [selectedKey],
    onClick: ({ key }: { key: string }) => onNavigate(key),
    className: 'border-none bg-transparent',
  };

  return (
    <div className="flex h-full flex-col bg-ink text-[#c5cedb]">
      <div
        className={`flex items-center border-b border-white/[.07] py-4 ${collapsed ? 'flex-col gap-2 px-[12px]' : 'gap-[10px] px-[18px]'}`}
      >
        {brand ? (
          brand.logoSrc ? (
            <img src={brand.logoSrc} alt={brand.name} className="h-[30px] w-[30px] shrink-0 rounded-[6px] bg-white object-contain p-[2px]" />
          ) : (
            <span aria-hidden="true" className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[6px] bg-brand font-display text-[13px] font-bold text-white">
              {brandInitials(brand.name)}
            </span>
          )
        ) : (
          <img src="/logo-mark.png" alt={organizationName ?? 'Zitaware CRM'} className="h-[30px] w-[30px] shrink-0 object-contain" />
        )}
        {!collapsed && (
          <div className="min-w-0 flex-1 font-display font-semibold leading-[1.2] text-white">
            <FittedBrandName name={brand?.name ?? organizationName ?? 'Zitaware CRM'} />
            <span className="mt-[1px] block text-[10px] font-semibold uppercase tracking-[.06em] text-muted-2">
              Business Portal
            </span>
          </div>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`grid h-6 w-6 shrink-0 place-items-center rounded-ui text-muted-2 hover:bg-white/10 hover:text-white ${collapsed ? '' : 'ml-auto'}`}
          >
            <ChevronLeftIcon className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      <nav className="sidebar-scroll flex-1 overflow-y-auto py-2" aria-label="Primary">
        {collapsed ? (
          <Menu
            {...menuProps}
            inlineCollapsed
            items={[
              ...toMenuItems(ungroupedItems)!,
              ...groupOrder.flatMap((group) => {
                const children = groupedItems.get(group)!;
                if (children.length === 1) return toMenuItems(children)!;
                return [{ key: group, type: 'group' as const, label: group, children: toMenuItems(children) }];
              }),
            ]}
          />
        ) : (
          <>
            {ungroupedItems.length > 0 && <Menu {...menuProps} items={toMenuItems(ungroupedItems)} />}
            {groupOrder.map((group) => {
              const children = groupedItems.get(group)!;
              if (children.length === 1) {
                return <Menu key={group} {...menuProps} items={toMenuItems(children)} />;
              }
              const isOpen = openGroups.has(group);
              const panelId = toPanelId(group);
              return (
                <div key={group}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex w-full items-center justify-between px-[18px] py-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-2 transition-colors hover:text-white"
                  >
                    <span>{group}</span>
                    <ChevronDownIcon
                      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-in-out ${isOpen ? '' : '-rotate-90'}`}
                    />
                  </button>
                  <div
                    id={panelId}
                    aria-hidden={!isOpen}
                    className="grid transition-[grid-template-rows] duration-200 ease-in-out"
                    style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden" inert={!isOpen || undefined}>
                      <Menu {...menuProps} items={toMenuItems(groupedItems.get(group)!)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </nav>
    </div>
  );
}
