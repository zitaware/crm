import { InputNumber } from 'antd';
import type { InputNumberProps } from 'antd';

function groupIndian(digits: string): string {
  const lastThree = digits.slice(-3) || '0';
  const rest = digits.slice(0, -3);
  if (!rest) return lastThree;
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
}

/** Indian digit grouping (lakh/crore) on a decimal string — preserves a
 * trailing "." and in-progress decimal digits untouched, since this also
 * runs on every keystroke while the user is still typing. */
function formatIndianAmount(value: string | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, decPart] = unsigned.split('.');
  const grouped = groupIndian(intPart ?? '');
  const withDecimal = decPart !== undefined ? `${grouped}.${decPart}` : grouped;
  return negative ? `-${withDecimal}` : withDecimal;
}

function parseIndianAmount(displayValue: string | undefined): string {
  return displayValue ? displayValue.replace(/,/g, '') : '';
}

/**
 * An amount in Indian units, for reading a long figure at a glance:
 * "₹ 1 Crore 25 Lakh 40 Thousand 500". Rupees only; paise are left to the
 * input itself. Empty for no amount, "₹ 0" for zero.
 */
export function amountInIndianUnits(value: string | undefined | null): string {
  if (value === undefined || value === null || value.trim() === '' || Number.isNaN(Number(value))) return '';
  const negative = value.trim().startsWith('-');
  let rupees = Math.floor(Math.abs(Number(value)));
  const parts: string[] = [];
  for (const [size, unit] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1_000, 'Thousand']] as const) {
    const count = Math.floor(rupees / size);
    if (count > 0) parts.push(`${count.toLocaleString('en-IN')} ${unit}`);
    rupees %= size;
  }
  if (rupees > 0 || parts.length === 0) parts.push(String(rupees));
  return `${negative ? '−' : ''}₹ ${parts.join(' ')}`;
}

export type MoneyInputProps = Omit<InputNumberProps<string>, 'stringMode' | 'formatter' | 'parser'> & {
  /** Show the amount in Crore / Lakh / Thousand under the input. */
  showInWords?: boolean;
};

/**
 * Decimal-string amount input with Indian digit grouping —
 * docs/15-ui-design-system.md §12.4/§21. `stringMode` keeps the bound
 * value a plain decimal string end-to-end (no binary float conversion,
 * matching this codebase's Decimal.js-everywhere rule); the
 * formatter/parser pair only ever changes what's shown on screen —
 * commas never reach Form validation or the submitted value.
 */
export function MoneyInput({ showInWords, ...props }: MoneyInputProps) {
  const input = (
    <InputNumber<string>
      stringMode
      controls={false}
      className="w-full"
      // AntD's own `.ant-input-number` stylesheet rule sets a fixed
      // width that beats Tailwind's `w-full` class in the cascade —
      // only an inline style reliably overrides it.
      style={{ width: '100%' }}
      formatter={(value) => formatIndianAmount(value)}
      parser={(value) => parseIndianAmount(value)}
      {...props}
    />
  );
  if (!showInWords) return input;
  const inWords = amountInIndianUnits(props.value ?? undefined);
  return (
    <>
      {input}
      {inWords ? <div className="mt-1 text-[12px] font-medium text-brand" aria-live="polite">{inWords}</div> : null}
    </>
  );
}
