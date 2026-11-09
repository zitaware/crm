import { useEffect } from 'react';

/** True when this Enter keydown would make the browser submit the field's form (implicit submission). */
export function isImplicitSubmit(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'target' | 'defaultPrevented'>): boolean {
  if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.form) return false;
  // Buttons, checkboxes and the like keep their own Enter behaviour; only text-like fields submit implicitly.
  return !['submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(target.type);
}

/**
 * Pressing Enter in a form field does not submit the form; a form is saved
 * only from its button. Listens on the document in the bubbling phase, after
 * the components' own handlers, so Enter still picks a Select option,
 * confirms a date or runs a search box, and a textarea still takes a new line.
 */
export function useNoEnterSubmit(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImplicitSubmit(event)) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
