import type { TaxDeductionType, TdsCertificateSource } from '@zitaware/contracts';

/** The CSV template's accepted spellings (ADR-112). Anything else is a row error, never a guess. */
const SOURCES: Record<string, TdsCertificateSource> = {
  CERTIFICATE: 'CERTIFICATE',
  FORM16A: 'CERTIFICATE',
  '16A': 'CERTIFICATE',
  GSTR7A: 'CERTIFICATE',
  STATEMENT: 'STATEMENT',
  '26AS': 'STATEMENT',
  FORM26AS: 'STATEMENT',
};
const TYPES: Record<string, TaxDeductionType> = { TDS: 'TDS', CGSTTDS: 'CGST_TDS', SGSTTDS: 'SGST_TDS', IGSTTDS: 'IGST_TDS' };

const key = (value: string) => value.toUpperCase().replace(/[\s_\-.]/g, '');

export function parseSource(value: string): TdsCertificateSource | null {
  return SOURCES[key(value)] ?? null;
}

export function parseDeductionType(value: string): TaxDeductionType | null {
  return TYPES[key(value)] ?? null;
}

/** YYYY-MM-DD, or DD/MM/YYYY and DD-MM-YYYY as Indian sheets write them; must be a real date. */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(v);
  if (dmy) iso = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Strips thousands separators and the rupee sign; a positive amount with at most 2 decimals. */
export function parseAmount(value: string): string | null {
  const v = value.replace(/[,\s₹]/g, '');
  return /^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? v : null;
}
