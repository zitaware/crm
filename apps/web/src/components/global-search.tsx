'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AutoComplete, Input, type InputRef } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { GlobalSearchHit, GlobalSearchKind } from '@zitaware/contracts';
import { trpc } from '@/server/trpc';

const GROUPS: Array<{ kind: GlobalSearchKind; label: string }> = [
  { kind: 'PROJECT', label: 'Projects' },
  { kind: 'CLIENT', label: 'Clients' },
  { kind: 'LEAD', label: 'Leads' },
  { kind: 'INVOICE', label: 'Invoices' },
  { kind: 'VENDOR_BILL', label: 'Vendor bills' },
  { kind: 'VENDOR', label: 'Vendors' },
  { kind: 'EMPLOYEE', label: 'Employees' },
];

/** Waits until typing pauses, so each keystroke is not a request. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The top-bar search: projects, clients, leads, invoices, vendor
 * bills, vendors and employees by name or number, only what the user may
 * see. Picking a match opens it. Ctrl+K (or /) jumps to the box.
 */
export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<InputRef>(null);
  const [text, setText] = useState('');
  const query = useSettled(text.trim(), 250);
  const results = trpc.search.global.useQuery({ query }, { enabled: query.length >= 2, staleTime: 30_000, placeholderData: (previous) => previous });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hits = query.length >= 2 ? (results.data ?? []) : [];
  const byKey = new Map(hits.map((hit) => [`${hit.kind}:${hit.id}`, hit]));
  const options = GROUPS.map((group) => ({
    label: <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-2">{group.label}</span>,
    options: hits
      .filter((hit) => hit.kind === group.kind)
      .map((hit: GlobalSearchHit) => ({
        value: `${hit.kind}:${hit.id}`,
        label: (
          <div className="flex min-w-0 flex-col py-[2px] leading-[1.3]">
            <span className="truncate text-[13px] font-semibold text-ink">{hit.title}</span>
            {hit.subtitle ? <span className="truncate text-[11.5px] text-muted">{hit.subtitle}</span> : null}
          </div>
        ),
      })),
  })).filter((group) => group.options.length > 0);

  const empty =
    query.length < 2 ? null : results.isFetching && hits.length === 0 ? (
      <div className="px-3 py-2 text-[12.5px] text-muted">Searching…</div>
    ) : (
      <div className="px-3 py-2 text-[12.5px] text-muted">Nothing found for “{query}”.</div>
    );

  return (
    <AutoComplete
      className="w-full"
      value={text}
      options={options}
      onSearch={setText}
      onChange={(value: string) => setText(byKey.has(value) ? text : value)}
      onSelect={(value: string) => {
        const hit = byKey.get(value);
        if (!hit) return;
        setText('');
        inputRef.current?.blur();
        router.push(hit.href);
      }}
      // The server has matched already; the box must not filter its answer again.
      filterOption={false}
      notFoundContent={empty}
      popupMatchSelectWidth={420}
      defaultActiveFirstOption
    >
      <Input
        ref={inputRef}
        allowClear
        prefix={<SearchOutlined className="text-muted-2" />}
        placeholder="Search projects, clients, invoices…  (Ctrl+K)"
        aria-label="Search"
      />
    </AutoComplete>
  );
}
