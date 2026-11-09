export type StatusTagTone = 'pos' | 'neg' | 'warn' | 'info' | 'mut' | 'brand';

const TONE_CLASSES: Record<StatusTagTone, string> = {
  pos: 'bg-positive-soft text-positive',
  neg: 'bg-negative-soft text-negative',
  warn: 'bg-warning-soft text-warning',
  info: 'bg-information-soft text-information',
  mut: 'bg-ui-2 text-muted',
  brand: 'bg-brand-soft text-brand',
};

/**
 * Common Phase 2 status vocabularies, mapped once here rather than
 * re-implemented per screen. Anything not covered falls back to `mut`
 * until the caller supplies an explicit `tone`.
 */
const STATUS_TONE_MAP: Record<string, StatusTagTone> = {
  ACTIVE: 'pos',
  OPEN: 'pos',
  UPLOADED: 'pos',
  SENT: 'pos',
  ON_TRACK: 'pos',
  INACTIVE: 'mut',
  DISABLED: 'mut',
  DELETED: 'mut',
  MAINTENANCE: 'mut',
  INVITED: 'info',
  MILESTONE_DUE: 'info',
  PENDING: 'warn',
  PENDING_UPLOAD: 'warn',
  SOFT_CLOSED: 'warn',
  DUE: 'warn',
  IN_PROGRESS: 'warn',
  LOCKED: 'neg',
  FAILED: 'neg',
  OVERDUE: 'neg',
  DEAD_LETTERED: 'neg',
  PROCESSING: 'brand',
  HOLD: 'brand',
};

export interface StatusTagProps {
  /** The canonical status value from server/domain data — never a hand-written display string. */
  status: string;
  /** Human-readable label. Defaults to a title-cased version of `status` (e.g. `SOFT_CLOSED` -> `Soft Closed`). */
  label?: string;
  /** Overrides the automatic tone lookup for statuses (or domains) not covered by the shared map. */
  tone?: StatusTagTone;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Canonical status pill — docs/15-ui-design-system.md §14.1. */
export function StatusTag({ status, label, tone }: StatusTagProps) {
  const resolvedTone = tone ?? STATUS_TONE_MAP[status.toUpperCase()] ?? 'mut';
  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-[20px] px-[9px] py-[3px] text-[11.5px] font-semibold leading-[1.3] ${TONE_CLASSES[resolvedTone]}`}
    >
      <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full bg-current opacity-90" />
      {label ?? titleCase(status)}
    </span>
  );
}
