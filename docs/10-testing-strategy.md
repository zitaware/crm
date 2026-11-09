# Testing Strategy

## Test layers

### Unit

- Money and rounding
- GST selection and calculation
- OPEX schedule generation
- Invoice/receipt settlement calculation
- Deduction lifecycle
- State transitions
- Permission resolution
- Posting-rule line generation

### Database integration

- Prisma queries and transactions
- Constraints and unique indexes
- Idempotency
- Optimistic concurrency
- Journal balancing
- Accounting-period locks
- Maker-checker constraints
- Allocation/release race conditions

### API integration

- Auth and authorization
- Command validation
- Atomic source+journal+audit/outbox writes
- Stable error codes
- File-link permission checks

### End-to-end

Use the HTML-derived screen contracts:

- Create CAPEX milestone and raise partial invoices.
- Create 36-month OPEX schedule and invoice a monthly installment.
- Record partial receipt with TDS, GST-TDS, penalty, and hold.
- Record one receipt against multiple invoices.
- Release a hold in multiple parts.
- Finalize vendor bill and make partial vendor payment.
- Import salary and allocate 100%.
- Receive and consume inventory.
- Reconcile bank transaction and lock period.

## Financial golden tests

### Payment sample correction

```text
Invoice total                         ₹37,76,000
− TDS                                  ₹3,20,000
− GST-TDS                                ₹64,000
− Penalties                            ₹2,00,000
− Hold                                 ₹4,00,000
= Actual bank receipt                 ₹27,92,000
```

Expected:

- Journal balances.
- Accounts Receivable credit equals ₹37,76,000 settled.
- Bank debit equals ₹27,92,000.
- Each deduction posts to its configured account.

### Hold release

```text
Initial bank receipt                 ₹1,52,60,000
Hold release 1                          ₹4,00,000
Hold release 2                          ₹3,00,000
= Cumulative cash received           ₹1,59,60,000
```

### OPEX rounding

```text
Total: ₹2,00,00,000
Count: 36
Rows 1–35: ₹5,55,556
Row 36: ₹5,55,540
Exact sum: ₹2,00,00,000
```

Also test paise precision and alternate rounding policies.

## Property/invariant tests

Generate many valid combinations and assert:

- Debit total equals credit total.
- Invoice total equals taxable plus taxes plus rounding.
- Intrastate and interstate tax paths do not coexist.
- OPEX schedule sum equals milestone amount.
- Receipt cash allocation sum does not exceed actual receipt.
- Invoice settled amount does not exceed eligible outstanding.
- Deduction release does not exceed outstanding.
- Submitted employee allocations total 100%.

## Concurrency tests

- Two users finalize the same invoice.
- Two receipts allocate the last invoice outstanding simultaneously.
- Two hold releases consume the same outstanding balance.
- Duplicate job delivery posts only once.
- Two invoice finalizations request the next sequence number.
- Approval occurs while request is modified.

## Migration tests

For every migration:

- Apply to empty database.
- Apply from previous release snapshot.
- Verify data/backfill.
- Run constraints and financial reconciliation.
- Test supported rollback/forward-fix strategy.

## UI tests

- Preserve HTML layout intent at desktop and mobile breakpoints.
- Keyboard navigation and accessible labels.
- Server-calculated totals replace stale client preview.
- Loading, conflict, forbidden, validation, and retry states.
- Draft recovery.
- Document upload failure/retry.

## Reconciliation tests

For seeded scenarios verify:

- Source document totals
- Journal control account totals
- Tax-register totals
- Project totals
- Bank matched/unmatched totals
- Receivable/payable aging

No report may pass by using its own alternate formula.

The seeded scenario for these checks is `apps/api/src/testing/money-flow-scenario/`: three clients and five projects taken through billing, collection, purchase, stock, claims, salary and introducer fees via the real services, with every expected figure computed by hand in `expected.ts` (never copied from a run). Its spec asserts project and client totals, the Spend and Manpower reports, every ledger balance and the trial balance, and reconciles the screens to the ledger. `npm --workspace api run demo:money-flow` loads the same scenario into a separate demo organization for a manual pass, with a sheet of the expected numbers.

## Release gate

A phase is not complete until:

- Unit and integration tests pass.
- Required E2E flow passes.
- Migration checks pass.
- No unbalanced journal is possible.
- Permissions and audit events are verified.
- Documentation and progress are updated.

