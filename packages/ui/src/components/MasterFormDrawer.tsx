import { Button, Drawer } from 'antd';
import type { ReactNode } from 'react';

export interface MasterFormDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  onSaveDraft?: () => void;
  submitting?: boolean;
  draftSaving?: boolean;
  submitLabel?: string;
  drafted?: boolean;
  children: ReactNode;
}

/**
 * Shared drawer for master create/edit forms — docs/16-html-module-reference.md
 * §7.1 ("MasterFormDrawer or equivalent page section"). AntD's Drawer traps
 * focus and returns it to the trigger on close.
 */
export function MasterFormDrawer({
  open,
  title,
  onClose,
  onSubmit,
  onSaveDraft,
  submitting = false,
  draftSaving = false,
  submitLabel = 'Save',
  drafted = false,
  children,
}: MasterFormDrawerProps) {
  return (
    <Drawer
      open={open}
      title={title}
      onClose={onClose}
      width={480}
      destroyOnHidden
      footer={
        <div>
          {drafted ? (
            <div className="mb-3 flex items-center gap-3 rounded-ui border border-brand bg-brand-soft px-4 py-3 text-left">
              <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
              <p className="text-[13.5px] font-semibold text-ink">
                Drafted form. Click <span className="text-brand">{submitLabel}</span> to add this record.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-[10px]">
            <Button onClick={onClose}>Cancel</Button>
            {onSaveDraft ? (
              <Button htmlType="button" loading={draftSaving} onClick={onSaveDraft}>
                Save as draft
              </Button>
            ) : null}
            <Button type="primary" loading={submitting} onClick={onSubmit}>
              {submitLabel}
            </Button>
          </div>
        </div>
      }
    >
      {children}
    </Drawer>
  );
}
