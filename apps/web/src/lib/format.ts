export function formatMoney(value: string | null): string {
  if (!value) return '—';
  return `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ADR-089/ADR-090: some server-computed figures (invoiceOutstanding,
 * clientReceivable) are never clamped to zero — a negative value is a
 * genuine credit balance (over-settlement), rendered with its own tone
 * rather than as a warning-amber "Outstanding" figure. */
export function isCreditBalance(amount: string): boolean {
  return amount.trim().startsWith('-');
}

export function absMoney(amount: string): string {
  return amount.startsWith('-') ? amount.slice(1) : amount;
}

/** Every date the user sees or types (docs/15: DD/MM/YYYY; API values stay ISO). */
export const DATE_FORMAT = 'DD/MM/YYYY';

const pad = (n: number) => String(n).padStart(2, '0');

/** A business date (YYYY-MM-DD) or a timestamp, as DD/MM/YYYY. */
export function formatDate(value: string): string {
  const businessDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  // Read a plain date as written; new Date() would treat it as UTC midnight.
  if (businessDate) return `${businessDate[3]}/${businessDate[2]}/${businessDate[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** A timestamp as DD/MM/YYYY HH:mm in the viewer's time zone. */
export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A headline amount in Indian short form: ₹2.41 Cr, ₹83.2 L, else whole rupees (₹80,000). Pair it with formatMoney where the exact figure matters. */
export function formatMoneyShort(value: string | null): string {
  if (!value) return '—';
  const n = Number(value);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}
