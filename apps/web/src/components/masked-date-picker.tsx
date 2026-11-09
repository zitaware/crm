'use client';

import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { DatePicker as AntDatePicker, TimePicker as AntTimePicker } from 'antd';
import type { DatePickerProps, TimePickerProps } from 'antd';
import type { RangePickerProps } from 'antd/es/date-picker';
import { DATE_FORMAT } from '@/lib/format';

const TIME_FORMAT = 'HH:mm';

/**
 * The text box inside a masked picker. Ant Design's mask keeps the unfilled
 * parts as format letters ("10/MM/YYYY"); this shows them as dd/MM/yyyy
 * ("dd/10/yyyy") and shows the empty template even before the box is
 * clicked, so a click lands on the day, month or year and typing goes there.
 * Only the display changes: the picker still reads and writes its own text.
 */
function templateInput(format: string) {
  // DD/MM/YYYY is shown as dd/MM/yyyy; HH:mm as it is.
  const display = (text: string) => text.replace(/D/g, 'd').replace(/Y/g, 'y');
  const template = display(format);
  const TemplateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TemplateInput({ value, style, onKeyDown, ...rest }, ref) {
    const text = typeof value === 'string' ? value : '';
    const shown = rest.disabled && !text ? '' : text ? display(text) : template;
    const blank = !/\d/.test(shown);

    // Backspace on a part that is already empty steps back to the part before
    // and clears it, so the cursor never sticks. The picker moves one part at
    // a time, so the clear runs once it has moved (after its next render).
    const clearAfterMove = useRef(false);
    useLayoutEffect(() => {
      if (!clearAfterMove.current) return;
      clearAfterMove.current = false;
      onKeyDown?.({ key: 'Backspace', preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent<HTMLInputElement>);
    });
    const onTemplateKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      const box = event.currentTarget;
      const start = box.selectionStart ?? 0;
      const part = box.value.slice(start, box.selectionEnd ?? start);
      if (event.key === 'Backspace' && start > 0 && part && !/\d/.test(part)) {
        event.preventDefault();
        clearAfterMove.current = true;
        // The same event, read as a left arrow (its methods stay on the prototype).
        onKeyDown?.(Object.assign(Object.create(event) as KeyboardEvent<HTMLInputElement>, { key: 'ArrowLeft' }));
        return;
      }
      onKeyDown?.(event);
    };

    return (
      <input
        ref={ref}
        {...rest}
        value={shown}
        onKeyDown={onTemplateKeyDown}
        style={blank ? { ...style, color: 'var(--color-muted-2)' } : style}
      />
    );
  });
  return TemplateInput;
}

const DATE_INPUT = { input: templateInput(DATE_FORMAT) };
const TIME_INPUT = { input: templateInput(TIME_FORMAT) };

/** Typing digits fills DD/MM/YYYY in place: "29102026" reads 29/10/2026. */
const DATE_MASK = { format: DATE_FORMAT, type: 'mask' as const };

/** A day picker with no format, or with the app's own, gets the mask; month and year pickers keep theirs, since their screens read the picker's text. */
function isMaskedDay(picker: string | undefined, format: unknown): boolean {
  return (!picker || picker === 'date') && (format === undefined || format === DATE_FORMAT);
}

function MaskedDatePicker(props: DatePickerProps) {
  if (!isMaskedDay(props.picker, props.format)) return <AntDatePicker {...props} />;
  return <AntDatePicker {...props} format={DATE_MASK} components={DATE_INPUT} />;
}

function MaskedRangePicker(props: RangePickerProps) {
  if (!isMaskedDay(props.picker, props.format)) return <AntDatePicker.RangePicker {...props} />;
  return <AntDatePicker.RangePicker {...props} format={DATE_MASK} components={DATE_INPUT} />;
}

/**
 * Ant Design's DatePicker, with every day field typed into a dd/MM/yyyy
 * template. Import this in place of antd's `DatePicker`;
 * `DatePicker.RangePicker` works the same way.
 */
export const DatePicker = Object.assign(MaskedDatePicker, { RangePicker: MaskedRangePicker });

/** The same for a time of day: "0930" typed into HH:mm reads 09:30 (24-hour). No screen asks for a time yet; use this when one does. */
export function TimePicker(props: TimePickerProps) {
  if (props.format !== undefined && props.format !== TIME_FORMAT) return <AntTimePicker {...props} />;
  return <AntTimePicker {...props} format={{ format: TIME_FORMAT, type: 'mask' }} components={TIME_INPUT} />;
}
