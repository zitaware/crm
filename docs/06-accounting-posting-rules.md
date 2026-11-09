# Accounting Posting Rules

## Principles

- Accrual-based, double-entry accounting.
- Posting occurs only at approved business events.
- Each source event has one unique posting key.
- Journal debit equals journal credit.
- Posted journal entries are immutable.
- Reversal entries reference the original entry.
- Each line stores legal entity and source-document dimensions.
- Project, party, employee, tax registration, and cost centre are added where applicable.

## Journal structure

### Header

- legal entity
- accounting date
- financial year and period
- source type and source ID
- posting event
- idempotency key
- description
- status: `DRAFT`, `POSTED`, `REVERSED`
- reversal/original reference
- posted by/at

### Lines

- ledger account
- debit amount
- credit amount
- currency
- project
- party
- employee
- GST registration
- tax code
- narrative

Each line has either a debit or credit amount, never both.

## Income lifecycle

### Issue proforma invoice

A proforma is not a tax invoice. Issuing it posts nothing: no receivable, no revenue, and no output GST. The document receives a proforma number. The payment alert stays open.

### Convert proforma to a tax invoice

Converting an issued proforma opens a separate tax-invoice draft copied from it. The lines, GST, date, heading, and bank may be changed before that draft is posted. The proforma stays: same number, same amounts, same PDF, and still no journal.

Posting uses the finalize client invoice entry below, on the tax-invoice date, for the tax invoice's amounts. The proforma number stays on the proforma. The tax invoice records which proforma it came from.

Voiding the tax-invoice draft before it is posted puts the proforma back. Voiding the posted tax invoice reverses the journal and reopens the payment alert. The proforma stays.

### Finalize client invoice

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Receivable — Client | Invoice total | 0 |
| Project Revenue — CAPEX/OPEX | 0 | Taxable value |
| Output CGST Payable | 0 | CGST |
| Output SGST Payable | 0 | SGST |
| Output IGST Payable | 0 | IGST |

### Record client receipt with deductions

Example settlement:

| Account | Debit | Credit |
|---|---:|---:|
| Bank | Actual cash received | 0 |
| TDS Receivable | TDS deducted | 0 |
| GST-TDS Receivable — CGST | CGST-TDS | 0 |
| GST-TDS Receivable — SGST | SGST-TDS | 0 |
| GST-TDS Receivable — IGST | IGST-TDS | 0 |
| Hold Receivable | Hold amount | 0 |
| Retention Receivable | Retention amount | 0 |
| Disputed Deduction Receivable | Disputed penalty | 0 |
| Penalty Expense/Revenue Deduction | Accepted penalty | 0 |
| Accounts Receivable — Client | 0 | Total invoice amount settled |

Invariant:

```text
cash received
+ TDS
+ GST-TDS
+ hold
+ retention
+ accepted penalty
+ disputed deduction
+ other classified deductions
= invoice amount settled
```

### Hold/retention release

| Account | Debit | Credit |
|---|---:|---:|
| Bank | Released amount | 0 |
| Hold/Retention Receivable | 0 | Released amount |

### Credit note

Reverse revenue/output tax/receivable according to the credited values. Reference the original invoice and preserve tax-period rules.

### Receipt reversal

Create an opposite journal. Do not delete the receipt or original journal.

## Procurement and expense

### Finalize vendor bill for expense

| Account | Debit | Credit |
|---|---:|---:|
| Expense/Project Cost | Taxable eligible expense | 0 |
| Input CGST Receivable | CGST | 0 |
| Input SGST Receivable | SGST | 0 |
| Input IGST Receivable | IGST | 0 |
| Accounts Payable — Vendor | 0 | Vendor bill total |

Ineligible GST is included in cost rather than Input GST Receivable.

### Finalize vendor bill for inventory

| Account | Debit | Credit |
|---|---:|---:|
| Inventory | Taxable inventory value plus ineligible tax | 0 |
| Eligible Input GST | Eligible GST | 0 |
| Accounts Payable — Vendor | 0 | Vendor bill total |

### Vendor payment with TDS

| Account | Debit | Credit |
|---|---:|---:|
| Accounts Payable — Vendor | Liability settled | 0 |
| Bank | 0 | Net amount paid |
| TDS Payable | 0 | TDS deducted |

### TDS deposited

| Account | Debit | Credit |
|---|---:|---:|
| TDS Payable | Deposit amount | 0 |
| Bank | 0 | Deposit amount |

### Direct expense paid immediately

| Account | Debit | Credit |
|---|---:|---:|
| Expense and eligible Input GST | Total debits | 0 |
| Bank/Cash/Card Payable | 0 | Total paid |

## Employee advance and claim

### Advance issued

| Account | Debit | Credit |
|---|---:|---:|
| Employee Advance Receivable | Advance | 0 |
| Bank/Cash | 0 | Advance |

### Approved expense claim against advance

| Account | Debit | Credit |
|---|---:|---:|
| Expense/Input GST | Approved cost | 0 |
| Employee Advance Receivable | 0 | Amount adjusted |

Additional reimbursement or recovery is posted separately.

## Inventory

### Project consumption

| Account | Debit | Credit |
|---|---:|---:|
| Project Material Cost | Consumption value | 0 |
| Inventory | 0 | Consumption value |

The costing method must be consistently defined before implementation. Recommended initial method: weighted average.

## Salary project costing

Salary import creates the gross salary cost/payable posting according to the accountant’s monthly import process. Allocation moves cost analytically to project/non-project dimensions without changing total salary expense.

```text
allocated project amount = gross salary × allocation percentage
```

Rounding remainder is assigned deterministically so allocations equal gross salary.

## EMD/SD

### Cash instrument lodged

| Account | Debit | Credit |
|---|---:|---:|
| EMD/SD Recoverable | Amount | 0 |
| Bank | 0 | Amount |

### Cash instrument returned

| Account | Debit | Credit |
|---|---:|---:|
| Bank | Amount | 0 |
| EMD/SD Recoverable | 0 | Amount |

### Bank Guarantee

Guarantee principal is tracked as an instrument/contingent exposure. Margin money, commission, and GST post through their own transactions.

## Subscription

Upcoming/Due cycle: no journal.

Actual vendor bill or expense: standard vendor bill/direct expense rule.

## Introducer

Accrual:

| Account | Debit | Credit |
|---|---:|---:|
| Introducer Commission Expense | Amount | 0 |
| Introducer Payable | 0 | Amount |

Payment follows vendor-style payable settlement with TDS where applicable. Excess payment posts to Introducer Advance Receivable.

## Mandatory posting controls

- Reject zero-line journal.
- Reject unbalanced journal.
- Reject negative debit/credit values.
- Reject both debit and credit on one line.
- Reject posting into Locked period.
- Reject duplicate idempotency key.
- Reject missing legal entity/source reference.
- Preserve source and snapshot references.

## Reports

Reports must explicitly name their basis:

- Accrual P&L
- Cash profitability
- Contract/budget performance
- Project contribution margin
- Bank cash flow

Do not label all of these as “profit.”

