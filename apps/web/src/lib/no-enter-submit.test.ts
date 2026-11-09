// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isImplicitSubmit } from './no-enter-submit';

function keydown(target: EventTarget, key = 'Enter', extra: Partial<KeyboardEvent> = {}) {
  return { key, isComposing: false, defaultPrevented: false, target, ...extra } as KeyboardEvent;
}

describe('isImplicitSubmit', () => {
  const form = document.createElement('form');
  const text = Object.assign(document.createElement('input'), { type: 'text' });
  const submit = Object.assign(document.createElement('button'), { type: 'submit' });
  const textarea = document.createElement('textarea');
  const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
  form.append(text, submit, textarea, checkbox);
  const loose = document.createElement('input');

  it('stops Enter in a text field of a form', () => {
    expect(isImplicitSubmit(keydown(text))).toBe(true);
  });

  it('leaves other keys, IME composition and handled events alone', () => {
    expect(isImplicitSubmit(keydown(text, 'a'))).toBe(false);
    expect(isImplicitSubmit(keydown(text, 'Enter', { isComposing: true }))).toBe(false);
    expect(isImplicitSubmit(keydown(text, 'Enter', { defaultPrevented: true }))).toBe(false);
  });

  it('leaves buttons, textareas, checkboxes and fields outside a form alone', () => {
    for (const target of [submit, textarea, checkbox, loose]) expect(isImplicitSubmit(keydown(target))).toBe(false);
  });
});
