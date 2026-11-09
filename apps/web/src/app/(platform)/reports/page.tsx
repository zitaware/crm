'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Empty, Input } from 'antd';
import { FilterCard, FilterField, PageHeader, StatusTag, UiCard } from '@zitaware/ui';
import { trpc } from '@/server/trpc';

/** Report catalogue — only the reports the caller may open (docs/04 §16, `report.getCatalog`). */
export default function ReportsPage() {
  const catalog = trpc.reports.getCatalog.useQuery();
  const [search, setSearch] = useState('');

  const term = search.trim().toLowerCase();
  const entries = (catalog.data ?? []).filter((e) => !term || `${e.title} ${e.description} ${e.categoryLabel}`.toLowerCase().includes(term));
  const categories = [...new Set(entries.map((e) => e.categoryLabel))];

  return (
    <>
      <PageHeader title="Reports" description="Read-only reports built from posted documents and the ledger. Each one names its accounting basis." />

      <UiCard flush className="mb-4">
        <FilterCard>
          <FilterField label="Search">
            <Input allowClear placeholder="Search reports…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[260px]" />
          </FilterField>
        </FilterCard>
      </UiCard>

      {catalog.isError ? <Alert type="error" showIcon className="mb-4" message="Could not load the report list. Please retry." /> : null}
      {catalog.isLoading ? <UiCard>Loading…</UiCard> : null}
      {catalog.isSuccess && entries.length === 0 ? (
        <UiCard>
          <Empty description={term ? 'No report matches this search.' : 'You have no report permissions yet.'} />
        </UiCard>
      ) : null}

      {categories.map((category) => (
        <UiCard key={category} title={category} className="mb-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries
              .filter((e) => e.categoryLabel === category)
              .map((e) => (
                <Link key={e.key} href={e.path} className="block rounded-ui border border-ui p-4 transition-colors hover:border-brand hover:bg-brand-soft">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[14px] font-bold text-ink">{e.title}</span>
                    <StatusTag status={e.basis} tone="info" />
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted">{e.description}</p>
                </Link>
              ))}
          </div>
        </UiCard>
      ))}
    </>
  );
}
