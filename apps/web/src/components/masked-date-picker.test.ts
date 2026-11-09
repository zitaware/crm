// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react';
import type { Dayjs } from 'dayjs';
import { DatePicker, TimePicker } from './masked-date-picker';

/** A click at character `at` of the box, as a mouse puts the cursor there. */
function clickAt(input: HTMLInputElement, at: number) {
  fireEvent.mouseDown(input);
  fireEvent.focus(input);
  input.setSelectionRange(at, at);
  fireEvent.mouseUp(input);
}

function type(input: HTMLInputElement, keys: string) {
  for (const key of keys) fireEvent.keyDown(input, { key });
}

function renderDate() {
  let picked: string | null = null;
  const onChange = (date: Dayjs | null) => {
    picked = date ? date.format('YYYY-MM-DD') : null;
  };
  const { container } = render(createElement(DatePicker, { onChange }));
  return { input: container.querySelector('input')!, picked: () => picked };
}

describe('DatePicker typed into a dd/MM/yyyy template', () => {
  it('shows the empty template before the box is clicked', () => {
    expect(renderDate().input.value).toBe('dd/MM/yyyy');
  });

  it('types where the box is clicked: month first, then day, then year', () => {
    const { input, picked } = renderDate();
    clickAt(input, 4);
    type(input, '10');
    expect(input.value).toBe('dd/10/yyyy');
    clickAt(input, 0);
    type(input, '29');
    clickAt(input, 8);
    type(input, '2026');
    expect(input.value).toBe('29/10/2026');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(picked()).toBe('2026-10-29');
  });

  it('fills day, month and year in turn when digits are typed straight through', () => {
    const { input, picked } = renderDate();
    clickAt(input, 0);
    type(input, '29102026');
    expect(input.value).toBe('29/10/2026');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(picked()).toBe('2026-10-29');
  });

  it('steps back with Backspace: clears the year, then the month, then the day', () => {
    const { input } = renderDate();
    clickAt(input, 0);
    type(input, '29102026');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input.value).toBe('29/10/yyyy');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input.value).toBe('29/MM/yyyy');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input.value).toBe('dd/MM/yyyy');
    // Typing again starts at the day.
    type(input, '01');
    expect(input.value).toBe('01/MM/yyyy');
  });

  it('Backspace right after a part is filled clears that part, not the empty one the cursor moved to', () => {
    const { input } = renderDate();
    clickAt(input, 0);
    type(input, '2910');
    expect(input.value).toBe('29/10/yyyy');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(input.value).toBe('29/MM/yyyy');
  });

  it('leaves a month picker on its own format', () => {
    const { container } = render(createElement(DatePicker, { picker: 'month' }));
    expect(container.querySelector('input')!.value).toBe('');
  });
});

describe('TimePicker typed into a HH:mm template', () => {
  it('fills HH:mm where it is clicked', () => {
    const { container } = render(createElement(TimePicker));
    const input = container.querySelector('input')!;
    expect(input.value).toBe('HH:mm');
    clickAt(input, 0);
    type(input, '0930');
    expect(input.value).toBe('09:30');
  });
});
