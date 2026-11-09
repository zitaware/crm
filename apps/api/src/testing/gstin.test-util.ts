/**
 * Builds a GSTIN that is unique to this test run.
 *
 * `uq_gst_registrations_gstin` is global — not scoped to an organization and
 * not filtered by `deleted_at` — so a hardcoded GSTIN in a spec fixture is a
 * process-wide singleton. If a spec's `beforeAll` throws for any reason its
 * `afterAll` never runs, the row survives, and every subsequent run of that
 * spec fails during setup with "this GSTIN is already registered" — a
 * failure that looks like a regression in whatever was changed last and has
 * nothing to do with it. This is the concrete mechanism behind one of the
 * flakiness classes ADR-077 records.
 *
 * Only the leading state code carries meaning in these fixtures (it is what
 * makes a supply intra- or inter-state, and therefore CGST+SGST or IGST);
 * everything after it is identity, never asserted on. So the state code is
 * the caller's and the rest is randomised into a shape the database's own
 * format CHECK accepts: NN AAAAA NNNN A [1-9A-Z] Z [0-9A-Z].
 *
 * Lives here rather than in `packages/testing` because `apps/api` has no
 * dependency on that package today and nothing currently imports from it;
 * adding one for a single helper would be a larger change than the fix.
 * `packages/testing` is its natural eventual home once that edge exists.
 */
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function pick(alphabet: string, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function uniqueGstin(stateCode: string): string {
  return `${stateCode}${pick(LETTERS, 5)}${pick('0123456789', 4)}${pick(LETTERS, 1)}${pick(`123456789${LETTERS}`, 1)}Z${pick(`0123456789${LETTERS}`, 1)}`;
}
