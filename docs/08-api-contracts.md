# API Contracts

The API uses tRPC with shared Zod schemas. Organize routers by domain, not by HTML page.

## Command/query separation

- Queries return read models optimized for screens.
- Commands express business intent and enforce transitions.
- Do not expose generic “update any fields” procedures for financial records.

## Standard command metadata

Financial and workflow commands include:

- idempotency key
- expected version
- correlation ID
- optional reason/notes

Server context supplies:

- authenticated user
- organization
- permissions
- IP/user agent
- request timestamp

## Error model

Use stable error codes:

- `VALIDATION_FAILED`
- `FORBIDDEN`
- `NOT_FOUND`
- `VERSION_CONFLICT`
- `INVALID_STATE_TRANSITION`
- `ACCOUNTING_PERIOD_LOCKED`
- `DUPLICATE_DOCUMENT_NUMBER`
- `ALLOCATION_EXCEEDS_OUTSTANDING`
- `DEDUCTION_RELEASE_EXCEEDS_OUTSTANDING`
- `JOURNAL_UNBALANCED`
- `SELF_APPROVAL_NOT_ALLOWED`
- `IDEMPOTENCY_CONFLICT`

Return field errors separately from business-rule errors.

## Project and milestone procedures

Queries:

- `project.list`
- `project.getDetail`
- `milestone.getProjectSummary`
- `milestone.getOpexSchedule`

Commands:

- `project.create`
- `project.changeStage`
- `project.changeStatus`
- `milestone.createCapex`
- `milestone.createOpex`
- `milestone.updateDraft`
- `milestone.markAchieved`
- `milestone.cancel`

`milestone.createOpex` returns the generated installment preview/result and exact total validation.

## Invoice procedures

Queries:

- `invoice.list`
- `invoice.get`
- `invoice.getDraftDefaults`
- `invoice.previewPdf`

Commands:

- `invoice.createDraft`
- `invoice.updateDraft`
- `invoice.finalize`
- `invoice.void`
- `creditNote.createDraft`
- `creditNote.finalize`
- `debitNote.createDraft`
- `debitNote.finalize`

Finalization response includes:

- invoice ID and number
- immutable totals
- journal entry ID
- generated-document status

## Client receipt procedures

Queries:

- `receipt.list`
- `receipt.get`
- `receipt.getAllocationCandidates`
- `deduction.getOutstanding`

Commands:

- `receipt.post`
- `receipt.reverse`
- `deduction.release`
- `receipt.matchBankTransaction`
- `receipt.unmatchBankTransaction`

`receipt.post` accepts:

- receipt header with actual cash amount
- one or more invoice allocations
- typed deductions per allocation
- optional unallocated amount

The backend returns and persists the canonical calculation. The frontend preview may call a pure server calculation procedure before posting.

## Procurement procedures

- `purchaseRequest.createDraft`
- `purchaseRequest.submit`
- `purchaseRequest.approve`
- `purchaseRequest.reject`
- `purchaseOrder.issue`
- `goodsReceipt.record`
- `vendorBill.createDraft`
- `vendorBill.finalize`
- `paymentRequest.submit`
- `paymentRequest.approve`
- `vendorPayment.post`

Approval commands enforce creator != approver.

## Files

- Request pre-signed upload.
- Complete upload with checksum and metadata.
- Link completed file to authorized entity/document slot.
- File access always checks parent-entity permission.

## Pagination and filtering

- Cursor pagination for large audit/ledger/activity tables.
- Stable sort by `(business_date, id)` or `(created_at, id)`.
- Date filtering uses business date for financial reports.
- All list endpoints enforce organization and permission scope.

## Transactions

Command handlers own the transaction. Routers/controllers must not independently create journal or audit records.

## Versioning

tRPC procedures evolve through additive inputs/outputs where possible. Breaking behavior uses an explicit new procedure or coordinated release.

