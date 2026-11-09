'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { App, Button } from 'antd';
import type { FormInstance } from 'antd';
import { trpc } from '@/server/trpc';

const DRAFT_KEY_STORE = 'zitaware-crm-form-draft-keys';
const DRAFT_KEY_EVENT = 'zitaware-crm-form-draft';

function readDraftKeys(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY_STORE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remembers which forms have an unfinished copy, so opening a form does not ask the server every time. */
function rememberDraftKey(formKey: string, present: boolean) {
  const keys = readDraftKeys();
  if (present) keys.add(formKey);
  else keys.delete(formKey);
  window.localStorage.setItem(DRAFT_KEY_STORE, JSON.stringify([...keys]));
  window.dispatchEvent(new Event(DRAFT_KEY_EVENT));
}

function subscribeDraftKeys(onStoreChange: () => void) {
  window.addEventListener(DRAFT_KEY_EVENT, onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener(DRAFT_KEY_EVENT, onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

/** A saved record clears the unfinished copy. Pages call this through the draft mutation. */
export function noteFormDraftCleared(queryClient: QueryClient, formKey: string) {
  rememberDraftKey(formKey, false);
  queryClient.setQueryData(getQueryKey(trpc.formDrafts.get, { formKey }, 'query'), { payload: null });
}

function useDraftKnown(formKey: string) {
  return useSyncExternalStore(
    subscribeDraftKeys,
    () => readDraftKeys().has(formKey),
    () => false,
  );
}

/** Loads and stores an unfinished form. Save as draft uses this and does not run field checks. */
export function useFormDraft(formKey: string) {
  const { message } = App.useApp();
  const utils = trpc.useUtils();
  const known = useDraftKnown(formKey);
  const query = trpc.formDrafts.get.useQuery(
    { formKey },
    {
      enabled: formKey.length > 0 && known,
      staleTime: Infinity,
      gcTime: 60 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  useEffect(() => {
    if (!query.isSuccess || query.data?.payload != null) return;
    if (!readDraftKeys().has(formKey)) return;
    rememberDraftKey(formKey, false);
  }, [formKey, query.isSuccess, query.data]);
  const saveMutation = trpc.formDrafts.save.useMutation({
    onSuccess: (_data, variables) => {
      message.success('Draft saved.');
      rememberDraftKey(variables.formKey, true);
      utils.formDrafts.get.setData({ formKey: variables.formKey }, { payload: variables.payload });
    },
    onError: (error) => message.error(error.message),
  });
  const clearMutation = trpc.formDrafts.clear.useMutation({
    onSuccess: (_data, variables) => {
      rememberDraftKey(variables.formKey, false);
      utils.formDrafts.get.setData({ formKey: variables.formKey }, { payload: null });
    },
  });

  return {
    isLoading: query.isLoading,
    payload: query.data?.payload ?? null,
    saving: saveMutation.isPending,
    save: (payload: Record<string, unknown>) => saveMutation.mutate({ formKey, payload }),
    clear: () => clearMutation.mutate({ formKey }),
  };
}

/**
 * Copies a saved draft into a form that is already on screen. Skipped once the
 * user has typed, so a late reply cannot wipe what they entered.
 */
export function useApplyFormDraft(
  form: FormInstance,
  payload: Record<string, unknown> | null,
  map?: (payload: Record<string, unknown>) => Record<string, unknown>,
) {
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !payload) return;
    applied.current = true;
    if (form.isFieldsTouched()) return;
    form.setFieldsValue(map ? map(payload) : payload);
  }, [form, payload, map]);
}

export function DraftFormNote({ saveLabel = 'Save' }: { saveLabel?: string }) {
  return (
    <div className="mb-3 flex w-full items-center gap-3 rounded-ui border border-brand bg-brand-soft px-4 py-3">
      <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
      <p className="text-[13.5px] font-semibold text-ink">
        Drafted form. Click <span className="text-brand">{saveLabel}</span> to add this record.
      </p>
    </div>
  );
}

export function FormSaveButtons({
  onCancel,
  onDraft,
  submitting,
  saveLabel,
  drafted = false,
}: {
  onCancel: () => void;
  onDraft: () => void;
  submitting?: boolean;
  saveLabel: string;
  drafted?: boolean;
}) {
  return (
    <div>
      {drafted ? <DraftFormNote saveLabel={saveLabel} /> : null}
      <div className="flex justify-end gap-[10px]">
        <Button htmlType="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button htmlType="button" onClick={onDraft} loading={submitting ?? false}>
          Save as draft
        </Button>
        <Button type="primary" htmlType="submit" loading={submitting ?? false}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
