'use client';

import Link from 'next/link';
import { Spin } from 'antd';
import { PageHeader } from '@zitaware/ui';
import { trpc } from '@/server/trpc';
import { GEOGRAPHY_CATALOG, MASTER_CATALOG, type MasterCatalogItem } from './catalog';

function MasterTile({
  href,
  label,
  description,
  count,
}: {
  href: string;
  label: string;
  description: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-ui border border-ui bg-surface p-4 shadow-ui transition-colors hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-bold text-ink">{label}</span>
          <span className="ml-auto shrink-0 rounded-[20px] bg-ui-2 px-2 py-[1px] text-[11px] font-bold tabular-nums text-muted">
            {count}
          </span>
        </div>
        <p className="mt-[6px] text-[12px] leading-snug text-muted">{description}</p>
      </div>
    </Link>
  );
}

// Masters catalogue — reference references/ui/html/01-platform/masters-all.html.
// Tiles are permission-filtered and show each master's record count from
// masters.getCatalog. Individual masters are reached here (not the sidebar),
// matching the prototype's single "Masters" nav entry.
export default function MastersCatalogPage() {
  const me = trpc.auth.me.useQuery();
  const catalog = trpc.masters.getCatalog.useQuery();
  const geoCounts = trpc.geography.getCounts.useQuery();
  const penaltyCount = trpc.penaltyCategories.getCount.useQuery();

  const permissions = new Set(me.data?.permissions ?? []);
  const countByType = new Map((catalog.data ?? []).map((entry) => [entry.type, entry.count]));

  const visibleItems = MASTER_CATALOG.filter((item) => permissions.has(item.permission));
  const visibleGeography = GEOGRAPHY_CATALOG.filter((item) => permissions.has(item.permission));
  const groups = new Map<string, MasterCatalogItem[]>();
  for (const item of visibleItems) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }

  return (
    <>
      <PageHeader
        title="Masters"
        description="Reference data that powers dropdowns across the portal. Add, edit and deactivate master records here."
      />

      {me.isLoading || catalog.isLoading ? (
        <div className="flex justify-center py-10">
          <Spin />
        </div>
      ) : catalog.isError ? (
        <div className="rounded-ui border border-ui bg-surface p-6 text-center text-[13px] text-muted" role="alert">
          Could not load the masters catalogue. Please retry.
        </div>
      ) : visibleItems.length === 0 && visibleGeography.length === 0 ? (
        <div className="rounded-ui border border-ui bg-surface p-6 text-center text-[13px] text-muted">
          You do not have permission to view any master records.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(groups.entries()).map(([group, items]) => (
            <section key={group}>
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[.09em] text-muted-2">{group}</h2>
              <div className="grid grid-cols-1 gap-[13px] sm:grid-cols-2 min-[980px]:grid-cols-3">
                {items.map((item) => (
                  <MasterTile
                    key={item.type}
                    href={`/masters/${item.type}`}
                    label={item.pluralLabel}
                    description={item.description}
                    count={countByType.get(item.type) ?? 0}
                  />
                ))}
                {/* Penalty categories are a dedicated master (they carry an extra
                    basis_type field) — grouped with the other finance masters. */}
                {group === 'Documents & Finance' && permissions.has('master.read') ? (
                  <MasterTile
                    href="/masters/penalty-categories"
                    label="Penalty Categories"
                    description="Penalty categories and their default calculation basis."
                    count={penaltyCount.data ?? 0}
                  />
                ) : null}
              </div>
            </section>
          ))}

          {visibleGeography.length > 0 ? (
            <section>
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[.09em] text-muted-2">Geography</h2>
              <div className="grid grid-cols-1 gap-[13px] sm:grid-cols-2 min-[980px]:grid-cols-3">
                {visibleGeography.map((item) => (
                  <MasterTile
                    key={item.path}
                    href={item.path}
                    label={item.pluralLabel}
                    description={item.description}
                    count={geoCounts.data?.[item.countKey] ?? 0}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}
