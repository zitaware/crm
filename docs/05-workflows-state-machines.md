# Workflows and State Machines

State transitions must be explicit commands with permission checks, validation, audit events, and optimistic concurrency protection.

## Project

### Stage

A new project starts at WORK_STARTED (ADR-133). Any later stage can be chosen directly (ADR-132).

```text
WON
→ WORK_ORDER_RECEIVED
→ WAITING_FOR_PERMISSIONS
→ WORK_STARTED
→ WORK_DONE
→ SUCCESSFULLY_COMPLETED
```

Backward movement requires a reason and audit event.

### Operational status

```text
ACTIVE ↔ ON_HOLD
ACTIVE/ON_HOLD → CANCELLED
ACTIVE/ON_HOLD → CLOSED
```

Cancelled and Closed are terminal for normal operations. Admin correction requires a separately authorized transition.

## Milestone

### Achievement state

```text
PLANNED → IN_PROGRESS → ACHIEVED
PLANNED/IN_PROGRESS → CANCELLED
```

### Billing state

Billing state is derived:

- `NOT_INVOICED`
- `PARTIALLY_INVOICED`
- `FULLY_INVOICED`

Do not store billing state as independently editable data.

By amount (ADR-156): an event or installment is `NOT_INVOICED` until a finalized invoice bills it, `PARTIALLY_INVOICED` while finalized invoices bill less than its amount, and `FULLY_INVOICED` once they reach it. It may be billed across several finalized invoices; only one invoice per event or installment may be open (draft or issued proforma) at a time.

## OPEX schedule

```text
PLANNED → ALERT_OPEN → INVOICE_DRAFT → INVOICED
PLANNED/ALERT_OPEN → SKIPPED
INVOICED → REPLACEMENT_REQUIRED
```

Rules:

- Schedule generation creates no accounting entry.
- Daily job opens alerts according to reminder settings.
- Draft invoice does not close the alert.
- Finalized invoice closes the alert and marks the installment Invoiced once the installment's scheduled amount is fully invoiced; billed in part, the alert stays open for the rest and the installment returns to Planned (ADR-156).
- Voiding a finalized invoice reopens a closed alert.
- An installment billed in part cannot be skipped; void its invoices first.
- Skipping requires reason and permission.

## Invoice

```text
DRAFT → FINALIZED → VOIDED
                 └→ CREDITED/PARTIALLY_CREDITED
```

Settlement is separately derived:

- `UNSETTLED`
- `PARTIALLY_SETTLED`
- `SETTLED`

Rules:

- Finalization atomically allocates the document number and posts the journal.
- Finalized fields cannot be edited.
- Void is allowed only through a controlled reversal/replacement action.
- Credit/debit notes are separate posted documents.

## Client receipt

```text
DRAFT → POSTED → REVERSED
```

Reconciliation is separate:

```text
UNMATCHED → PARTIALLY_MATCHED → MATCHED
MATCHED → UNMATCHED
```

Unmatching a locked accounting/bank period is prohibited.

## Deduction lifecycle

### TDS and GST-TDS

```text
RECORDED → CERTIFICATE_PENDING → CERTIFICATE_RECEIVED → RECONCILED
```

### Hold/retention

```text
OUTSTANDING → PARTIALLY_RELEASED → RELEASED
OUTSTANDING/PARTIALLY_RELEASED → FORFEITED
```

### Penalty

```text
RECORDED → ACCEPTED
         → DISPUTED → RESOLVED_ACCEPTED
                    → RESOLVED_REVERSED
```

## Procurement

```text
DRAFT
→ SUBMITTED
→ APPROVED
→ OPTIONAL_PO
→ RECEIVED
→ VENDOR_BILL_FINALIZED
→ PAYMENT_REQUESTED
→ PAYMENT_APPROVED
→ PARTIALLY_PAID/PAID
→ RECONCILED
```

Rejection path:

```text
SUBMITTED → REJECTED
PAYMENT_REQUESTED → PAYMENT_REJECTED
```

Maker-checker:

- Creator cannot approve own request.
- Accountant can approve.
- Assigned Project Manager can approve project-scoped request.

## Subscription

```text
ACTIVE ↔ PAUSED
ACTIVE/PAUSED → CANCELLED
```

Cycle:

```text
UPCOMING → DUE → RECORDED → PAID → RECONCILED
UPCOMING/DUE → SKIPPED
```

Reminder/cycle generation does not create a journal.

## Employee monthly allocation

```text
DRAFT → SUBMITTED → LOCKED
```

- Draft may total less than 100%.
- Submission requires exactly 100%.
- Locked allocation changes require an authorized unlock with reason.

## Accounting period

```text
OPEN → SOFT_CLOSED → LOCKED
```

- Soft Closed permits only authorized adjustments.
- Locked prohibits normal postings.
- Reopen requires Admin authorization and creates an audit event.

## Bank reconciliation period

```text
OPEN → IN_PROGRESS → RECONCILED → LOCKED
```

Lock requires zero unexplained difference or explicit approved exception.

