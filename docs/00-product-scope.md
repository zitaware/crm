# Product Scope

## Purpose

Zitaware CRM is an internal enterprise system for Zitaware Solutions to manage the complete lifecycle of client work for any kind of client — companies, startups, individuals or public bodies. It is not specific to government work: there are no tenders and no EMD/SD (ADR-192).

`Client/Lead → Project → Delivery → Billing → Receipt → Procurement/Expense → Project Costing → Accounting → Reconciliation → Reports`

It replaces the static HTML prototype with a reliable, auditable application and a scalable PostgreSQL data model.

## Current organization

- One current organization: Zitaware Solutions.
- One current legal entity and one GST registration are initially configured.
- The model supports approximately 3–4 legal entities and multiple GST registrations per entity without making the initial UI complicated.
- INR is the operating currency.
- Financial year is April 1 through March 31.
- Default display timezone is `Asia/Kolkata`.

## In scope

### Platform

- Authentication and session management
- System users, employees, roles, permissions, and per-user overrides
- Legal entities and GST registrations
- Lookup masters
- Documents and file storage
- Audit history
- Notifications and scheduled reminders
- Financial years and accounting periods

### CRM and project delivery

- Clients, contacts, and addresses
- Leads
- Projects connected to a Lead
- Project stages and operational statuses
- Project team assignment
- CAPEX and OPEX milestones
- Payment alerts
- Physical progress
- Project documentation

### Finance income

- CRM-generated GST invoices
- Multiple invoices per CAPEX milestone
- One invoice per normal OPEX installment
- Client receipts
- Multi-invoice receipt allocation
- Partial receipts
- TDS and GST-TDS tracking
- Holds, retention, penalties, disputes, and releases
- Credit notes, debit notes, void/replacement handling
- Bank transaction import and reconciliation

### Finance expense and procurement

- Vendors
- Purchase requests and approval
- Optional purchase orders
- Goods/service receipt
- Vendor bills
- Payment requests
- Vendor payments
- Direct expenses
- Employee advances, claims, and reimbursements
- Simple subscriptions and renewal reminders
- Server-related recurring costs

### HR and costing

- Employee master separate from user access
- Monthly gross-salary import
- One monthly employee allocation workflow
- Project, Bench, Leave, Internal Administration, Training, and Business Development allocation targets
- Project manpower cost derived from gross salary and allocation percentage

### Inventory and other commercial tracking

- One central inventory location
- Product/item master
- Stock receipt linked to an approved purchase where applicable
- Project/employee consumption
- Introducer agreements, advances, payments, and allocations

### Accounting and intelligence

- Chart of Accounts
- Double-entry general ledger
- Accrual accounting
- Accounting periods and locks
- GST and TDS registers
- Project accrual P&L
- Cash profitability
- Cash flow
- Receivable/payable aging
- Bank reconciliation
- Audit and exception reports

## Explicitly out of scope

- Public customer portal
- Mobile application in the first release
- Full payroll processing
- Attendance and leave payroll calculation
- Fixed-asset register and depreciation schedule
- Multiple inventory warehouses or project-site stock locations
- Automatic GST filing
- Automatic bank API integration in the first slice
- Multi-currency transaction processing in the first release
- White-label multi-tenant product behavior

## UI policy

The 105 functional HTML screens are the visual and interaction baseline. Existing themes, cards, tabs, navigation concepts, and field groupings should be preserved.

Minor changes are required where the existing screens would create accounting or reconciliation ambiguity. These changes are recorded in `04-screen-contracts.md`.

## Success criteria

- No ambiguous amount named only “received” or “paid.”
- Every rupee can be traced from source document to allocation, deduction, journal line, and bank reconciliation.
- Every posted transaction is balanced, immutable, idempotent, and auditable.
- CAPEX and OPEX billing behave differently while sharing invoice and receipt infrastructure.
- Reports agree with source documents and ledger balances.

