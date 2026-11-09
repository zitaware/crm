import type { Dayjs } from 'dayjs';

/** A picked date as the ISO YYYY-MM-DD string the API expects ('' when
 * cleared). Use this, not a picker's formatted string: pickers display
 * DD/MM/YYYY (docs/15). */
export function isoDate(date: Dayjs | null | undefined): string {
  return date ? date.format('YYYY-MM-DD') : '';
}

/** A picked range as two ISO strings, each '' when not set. */
export function isoRange(dates: [Dayjs | null, Dayjs | null] | null | undefined): [string, string] {
  return [isoDate(dates?.[0]), isoDate(dates?.[1])];
}

/** A picked range as two ISO strings, or null unless both ends are set. */
export function completeIsoRange(dates: [Dayjs | null, Dayjs | null] | null | undefined): [string, string] | null {
  const [from, to] = isoRange(dates);
  return from && to ? [from, to] : null;
}
