import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest.config.ts doesn't set `test.globals`, so Testing Library's own
// auto-cleanup (which hooks a global afterEach) never registers — without
// this, DOM from one test leaks into the next in the same file.
afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia implementation; AntD's responsive Grid/Menu
// hooks (useBreakpoint, responsiveObserver) call it on mount.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
