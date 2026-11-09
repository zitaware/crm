# Domain Model

This document defines aggregate boundaries and relationships. It is not yet the final Prisma schema.

## Foundation

```text
organizations
└── legal_entities
    ├── gst_registrations
    ├── bank_accounts
    ├── financial_years
    │   └── accounting_periods
    └── document_sequences

users
├── user_roles
├── user_permission_overrides
└── sessions

employees
└── optional user_id
```

## Parties

Use a common party foundation to avoid duplicate legal identity, contact, address, PAN, and GST data.

```text
parties
├── party_addresses
├── party_contacts
├── party_gst_registrations
├── client_profiles
├── vendor_profiles
└── introducer_profiles
```

A party may have more than one role.

## CRM and projects

```text
leads ───────────────┐
                     ├── projects
tenders ─────────────┘     ├── project_team_members
                           ├── project_milestones
                           │   └── milestone_installments
                           ├── project_progress_updates
                           └── project_documents

security_instruments
├── optional tender_id
└── optional project_id
```

### Project invariants

- Project belongs to one organization and one owning legal entity.
- Project has one client party.
- Project may reference a Lead, Tender, or both.
- Stage and operational status are separate.
- Project monetary summary values are derived, not manually maintained.

## Milestones and schedules

### `project_milestones`

Common fields:

- project
- type: `CAPEX` or `OPEX`
- code
- name
- approved amount
- currency
- service start/end where applicable
- achievement status
- billing status, derived
- alert settings
- version

### CAPEX detail

CAPEX may use a milestone directly as the billing event or have event rows when one CAPEX pool contains several approved billing events.

### OPEX installments

`milestone_installments` stores:

- milestone
- sequence number
- service period start/end
- planned invoice date
- scheduled taxable amount
- status
- active invoice link, if finalized

Unique key:

`(milestone_id, sequence_number)`

The sum of all installment scheduled amounts must exactly equal the milestone approved amount.

## Income

```text
project_milestones
└── invoices
    ├── invoice_lines
    ├── invoice_tax_summaries
    ├── invoice_documents
    └── credit_debit_notes

client_receipts
├── receipt_allocations
│   ├── allocation_deductions
│   └── deduction_releases
└── receipt_documents
```

### Invoice invariants

- Exactly one project and one milestone.
- OPEX invoice references exactly one installment.
- Seller and buyer legal/GST/address snapshots are immutable after finalization.
- Taxable value and explicit CGST/SGST/IGST totals reconcile to invoice total.
- Finalized invoice number is unique by GST registration and financial year among invoices that are not voided. A voided invoice keeps its number on record, and a later invoice may take that number (ADR-163).
- A finalized OPEX installment has at most one non-void active invoice.

### Receipt invariants

- Receipt belongs to one receiving legal entity and bank/cash account.
- All allocated invoices belong to the same receiving legal entity.
- Receipt allocations cannot exceed eligible invoice outstanding amounts.
- Sum of cash allocations equals actual receipt amount, except for explicitly unallocated receipt balance.
- Deduction settlement amounts plus cash allocation equal the invoice amount settled.

## Procurement and expenses

```text
purchase_requests
├── purchase_request_lines
├── approvals
├── optional purchase_orders
├── goods_service_receipts
└── vendor_bills
    ├── vendor_bill_lines
    └── payment_requests

vendor_payments
├── vendor_payment_allocations
└── vendor_tds_deductions

direct_expenses
employee_advance_transactions
employee_expense_claims
```

Purchase approval does not create an expense. Vendor bill finalization recognizes the liability/expense, inventory, or prepaid amount.

## Subscription

```text
subscriptions
└── subscription_cycles
    └── optional vendor_bill_or_expense_link
```

Cycle state is forecast/reminder state until linked to an actual posted expense or vendor bill.

## Inventory

```text
inventory_items
├── inventory_receipts
│   └── optional vendor_bill_line_id
└── inventory_consumptions
```

There is one logical inventory location in the first release. Keep a location identifier in the model only if needed to enforce the seeded central location consistently.

## Salary costing

```text
salary_import_batches
└── employee_monthly_salaries
    └── employee_monthly_allocations
```

Allocation targets:

- Project
- Bench
- Leave
- Internal Administration
- Training
- Business Development

The allocation total per employee/month must equal 100%.

## Introducer

```text
introducer_agreements
├── introducer_accruals
└── introducer_payments
    └── introducer_payment_allocations
```

An unallocated payment balance represents an introducer advance/overpayment.

## Accounting

```text
chart_of_accounts
├── account_groups
└── ledger_accounts

journal_entries
└── journal_lines

posting_rules
bank_transactions
reconciliation_matches
period_close_records
```

Each journal line may carry dimensions:

- legal entity
- project
- client/vendor/party
- employee
- GST registration
- source document type/id

## Cross-cutting

- `documents`
- `document_links`
- `audit_events`
- `workflow_actions`
- `outbox_events`
- `notifications`
- `job_runs`

