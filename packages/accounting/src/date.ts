/**
 * Business date: a calendar date with no time-of-day or timezone
 * component, stored as PostgreSQL `date` (format YYYY-MM-DD). Never
 * convert this through a timezone (docs/07-database-conventions.md).
 */
export type BusinessDate = string & { readonly __brand: 'BusinessDate' };

/**
 * Event timestamp: a UTC instant, stored as PostgreSQL `timestamptz`
 * (ISO 8601 with offset). Distinct from BusinessDate — never treat one
 * as the other.
 */
export type EventTimestamp = string & { readonly __brand: 'EventTimestamp' };

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function toBusinessDate(value: string): BusinessDate {
  if (!BUSINESS_DATE_PATTERN.test(value)) {
    throw new Error(`Expected YYYY-MM-DD business date, received: ${value}`);
  }
  return value as BusinessDate;
}

export function nowAsEventTimestamp(): EventTimestamp {
  return new Date().toISOString() as EventTimestamp;
}
