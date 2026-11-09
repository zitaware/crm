/** A business date (YYYY-MM-DD, or an ISO timestamp's date part) as
 * DD/MM/YYYY, the format every document and export shows (docs/15).
 * Anything else is returned unchanged. */
export function formatDisplayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
