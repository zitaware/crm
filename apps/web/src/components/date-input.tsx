'use client';

import { DatePicker } from '@/components/masked-date-picker';
import dayjs from 'dayjs';
import { DATE_FORMAT } from '@/lib/format';

/** A business-date field: shows and accepts DD/MM/YYYY, holds the ISO
 * YYYY-MM-DD string the API expects ('' when cleared). Drop-in for the
 * browser date input, whose display follows the viewer's locale. */
export function DateInput({
  value,
  onChange,
  className,
  ...rest
}: {
  value?: string | null;
  onChange?: (value: string) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <DatePicker
      {...rest}
      className={className ? `w-full ${className}` : 'w-full'}
      format={DATE_FORMAT}
      placeholder={rest.placeholder ?? DATE_FORMAT.toLowerCase()}
      value={value ? dayjs(value) : null}
      onChange={(date) => onChange?.(date ? date.format('YYYY-MM-DD') : '')}
    />
  );
}
