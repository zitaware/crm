import { configureStore } from '@reduxjs/toolkit';

// No slices yet — Phase 1 wires the store shell only. Domain slices are
// added per feature in later phases; server data flows through tRPC's
// query cache, not Redux (see docs/02-system-architecture.md).
export function makeStore() {
  return configureStore({
    // configureStore rejects an empty reducer map at runtime ("Store does
    // not have a valid reducer"). Until the first real domain slice lands,
    // a single no-op placeholder keeps the store valid. Replace it with the
    // real slice map when Redux is actually needed.
    reducer: {
      _placeholder: (state: null = null) => state,
    },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
