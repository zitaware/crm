# Module-wise HTML Reference Guide

Status: `DEVELOPMENT_BASELINE`

## 1. Purpose

This document is the file-selection guide for the Zitaware CRM static HTML
prototype. It tells developers and AI coding assistants exactly which HTML
files to inspect before implementing each module, workflow, or production
screen.

It exists because loading every prototype file for every task is unnecessary
and may cause important screen-specific details to be missed. Development must
use the smallest complete reference bundle for the current task.

This document does **not** replace the actual HTML files. Before implementation
of a screen begins, its listed HTML file and related shared reference files
must exist in the development repository.

## 2. Confirmed prototype inventory

The reviewed prototype contains:

| Type | Count |
|---|---:|
| Business screens | 103 |
| Shared/reference HTML files | 3 |
| Total valid HTML files | 106 |

The three non-route reference files are:

- `01-platform/index.html`
- `01-platform/shell.html`
- `01-platform/fonts.html`

Any earlier reference to “105 HTML files” is superseded by the verified
inventory above. Files inside `__MACOSX/` and files beginning with `._` are
macOS metadata duplicates and must never be copied or counted.

## 3. Required repository location

When the HTML package is added to the development repository, preserve this
structure:

```text
references/
└── ui/
    ├── html/
    │   ├── 01-platform/
    │   ├── 02-crm/
    │   ├── 03-projects/
    │   ├── 04-finance-income/
    │   ├── 05-finance-expense/
    │   ├── 06-hr-payroll/
    │   ├── 07-assets-inventory/
    │   ├── 08-banking/
    │   ├── 09-introducer-fee/
    │   └── 10-reports/
    └── screenshots/
        └── same module folders and base filenames
```

Example pair:

```text
references/ui/html/04-finance-income/project-invoice-add.html
references/ui/screenshots/04-finance-income/project-invoice-add.png
```

Do not rename prototype files while copying them. Production React route and
component names may differ, but this inventory must remain stable.

## 4. Authority and reading order

For every screen task, read sources in this order:

1. `docs/01-business-decisions.md` for locked business decisions.
2. Relevant workflow and accounting documents.
3. The screen entry in `docs/04-screen-contracts.md` for required functional
   changes, permissions, commands, state transitions, and accounting impact.
4. This document to identify the exact HTML reference bundle.
5. `docs/15-ui-design-system.md` for shared visual and component rules.
6. `references/ui/html/01-platform/shell.html` for the application shell.
7. The exact target screen HTML.
8. Related workflow HTML files listed in this document.
9. The target and related screenshots, when available.

HTML is authoritative for page-specific:

- visual hierarchy and composition;
- field discovery, grouping, order, and labels;
- cards, tables, filters, tabs, summaries, and action placement;
- intended user journey.

HTML is not authoritative for:

- accounting or tax formulas;
- database table design;
- permissions and maker-checker rules;
- state transitions;
- sample amounts, statuses, or calculations;
- React component boundaries.

Where a conflict exists, follow `04-screen-contracts.md` and preserve the
smallest possible visual deviation.

## 5. Standard module-development procedure

Before starting a module:

1. Confirm every listed HTML file for that module exists at the expected path.
2. Ignore metadata and duplicate files.
3. Read the module’s complete workflow bundle from section 7.
4. Compare the prototype fields with `04-screen-contracts.md`.
5. Record every retained, renamed, added, read-only, merged, or removed field in
   the task plan.
6. Identify shared components before building individual screens.
7. Implement one bounded list/form/detail workflow at a time.
8. Compare the completed production screen with its paired screenshot.
9. Verify business behavior separately from visual fidelity.

Do not begin frontend implementation when the target HTML is missing. The
developer may complete backend/domain work first, but the screen cannot be
declared UI-complete from this Markdown inventory alone.

## 6. Module summary and recommended implementation order

| Order | Module | Business HTML | Reference HTML | Primary workflow bundle |
|---:|---|---:|---:|---|
| 1 | Platform and Masters | 9 | 3 | Shell → Dashboard → Master catalogue → Master form/list |
| 2 | CRM | 9 | 0 | Client → Lead → Lead detail/documents/updates → Project conversion |
| 3 | Projects | 12 | 0 | Project → Progress/Documents/EMD-SD → Milestones |
| 4 | Finance — Income | 7 | 0 | Alert → Invoice → Receipt → Allocation/Deductions |
| 5 | Finance — Expense | 19 | 0 | Request → Approval → Bill → Payment; direct expense; recurring spend |
| 6 | HR and Salary Costing | 7 | 0 | Employee → Salary import → Monthly allocation → Project cost |
| 7 | Inventory | 5 | 0 | Product → Stock receipt → Consumption → Item ledger |
| 8 | Banking Masters | 4 | 0 | Bank → Account → Card/UPI |
| 9 | Introducer Fee | 4 | 0 | Introducer → Agreement/accrual → Payment |
| 10 | Reports | 27 | 0 | Report catalogue → Operational/financial reports → Source drill-down |
|  | **Total** | **103** | **3** |  |

The first financial vertical slice crosses modules 3, 4, and 8:

```text
project-milestone.html
→ project-milestone-add.html
→ project-payment-alert.html
→ project-invoice-add.html
→ project-invoices.html / invoices-all.html
→ project-payment-add.html
→ project-payment.html / payment-integration-all.html
→ bank account references and reconciliation
```

## 7. Detailed module reference inventory

### 7.1 Platform, shell, dashboard, and masters

Base path: `references/ui/html/01-platform/`

Always study `shell.html` and `fonts.html` before building the shared UI package.
`index.html`, `shell.html`, and `fonts.html` are references only and are not
production routes.

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `index.html` | `REFERENCE_ONLY` | Prototype entry/navigation behavior | `shell.html` |
| `shell.html` | `REFERENCE_ONLY` | Sidebar, top bar, search, page container, cards, tables, status styling, responsive shell | `fonts.html`, `15-ui-design-system.md` |
| `fonts.html` | `REFERENCE_ONLY` | Typography comparison only; no route | `shell.html`, centralized font tokens |
| `dashboard.html` | `MINOR_CHANGE` | Date filters, KPI cards, charts, category/project summaries, attention lists | `shell.html`, report screens supplying each value |
| `masters-all.html` | `ACCEPT` | Master catalogue cards, search, grouping, tile navigation | Every target master screen |
| `master-state.html` | `MINOR_CHANGE` | State name, code, GST state code, status, search/list pattern | `master-district.html` |
| `master-district.html` | `ACCEPT` | District, state, status, city count, search/list pattern | `master-state.html`, `master-city.html` |
| `master-city.html` | `ACCEPT` | City, district, state, status, hierarchical selectors | `master-district.html` |
| `master-expense-category.html` | `MINOR_CHANGE` | Category, type/classification, status, search/list | Expense and purchase forms |
| `master-lead-type.html` | `ACCEPT` | Lead type, description, status, usage count | `02-crm/lead-add.html` |
| `master-penalty-category.html` | `MINOR_CHANGE` | Category, default basis, status, usage | Receipt deduction and penalty report screens |
| `master-project-type.html` | `ACCEPT` | Project type, commercials/classification, status, project count | `03-projects/project-add.html` |

Shared components to derive:

- `AppShell`
- `SidebarNavigation`
- `Topbar`
- `PageHeader`
- `KpiCard`
- `FilterCard`
- `EntityTable`
- `MasterFormDrawer` or equivalent page section
- `StatusTag`

### 7.2 CRM

Base path: `references/ui/html/02-crm/`

#### Client workflow bundle

```text
client-list.html
→ client-add.html
→ client-view.html
```

#### Lead workflow bundle

```text
lead-list.html
→ lead-add.html
→ lead-view-detail.html
├── lead-view-documents.html
└── lead-view-updates.html
→ 03-projects/project-add.html
```

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `client-list.html` | `ACCEPT` | State, department, date filters; organization, location, contact, lead/project counts | `client-add.html`, `client-view.html` |
| `client-add.html` | `MINOR_CHANGE` | Organization identity, short name/code, type, department, address hierarchy, contacts, internal note | Geographic masters, `client-view.html` |
| `client-view.html` | `MINOR_CHANGE` | Client header, identity summary, contacts, linked Leads/Projects, financial summary layout | Client list/add and related project/invoice lists |

**Note (ADR-089):** the prototype's "Receivable" stat tile remains **not built** — Project Financial Stats deliberately scoped itself to per-project figures only (`ProjectFinancialsService`) and explicitly deferred the client-wide rollup across a client's projects as an immediate follow-up, closing the gap first flagged when this page was converted (docs/13-progress.md). When built, it must reuse `ProjectFinancialsService`'s own per-project authorization intersection, not a separate org-wide query.
| `lead-list.html` | `MINOR_CHANGE` | Client/type/introducer/stage/date filters; estimated value, last update, stage/status | `lead-add.html`, lead detail tabs |
| `lead-add.html` | `MINOR_CHANGE` | Title, client, type, description, estimate, introducer/source, dates, reminder, note | Lead list/detail, introducer master |
| `lead-view-detail.html` | `MINOR_CHANGE` | Record header, lead information, description, status/stage actions, Convert to Project | All lead tabs, `project-add.html` |
| `lead-view-documents.html` | `ACCEPT` | Document title, file, note, list, upload action | Lead detail, shared upload component |
| `lead-view-updates.html` | `ACCEPT` | Update title/note, actor/time timeline | Lead detail |
| `master-company.html` | `FUNCTIONAL_CHANGE` | Company identity form/list visual only | New Legal Entity and GST Registration screens; banking masters |

Important gaps: the prototype has no complete Tender screens. Tender list,
add/edit, detail, documents, updates, and Project linking/conversion are
`NEW_REQUIRED` screens and must follow the Lead visual language.

### 7.3 Projects, EMD/SD, progress, documents, and milestones

Base path: `references/ui/html/03-projects/`

#### Core Project bundle

```text
project-list.html
→ project-add.html
→ project-detail.html
├── project-physical.html
├── project-documentation.html
├── project-document-upload.html
├── project-expense.html
├── project-emdsd.html
└── project-milestone.html
```

#### EMD/SD bundle

```text
emdsd-all.html
→ emdsd-add.html
→ project-emdsd.html
```

#### Milestone bundle

```text
project-milestone.html
→ project-milestone-add.html
→ 04-finance-income/project-payment-alert.html
```

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `project-list.html` | `MINOR_CHANGE` | Type/client/entity/status/date filters; project value, receipts, expense, profit, EMD/SD, progress | Project detail and reports; keep Stage and Status separate |
| `project-add.html` | `MINOR_CHANGE` | Name, client, legal entity, Lead/Tender origin, description, value, budget, GST, work-order, dates, PM, introducer | CRM origin screens and Project detail |
| `project-detail.html` | `MINOR_CHANGE` | Project header/tabs, identity, descriptions, financial/physical summaries and actions | Every project tab |

**Project Financial Stats addendum (ADR-089), on `project-list.html`/`project-detail.html`:** no Profit/Margin column or tile is built anywhere (ADR-086 precedent — salary and other project costs aren't modeled). Colors follow docs/15 §16.1's sign-aware rules (neutral for contract/invoice values, positive for cash received, warning for outstanding, negative for recognized expense — matching the tab's own existing total-tile precedent) rather than the prototype's own hardcoded per-column colors, per CLAUDE.md's instruction to follow docs/15 for shared color conventions. `project-list.html`'s "receipts"/"expense"/"profit" columns become three new server-computed columns (Net Billed, Client Receivable, Recognized Expense), visible only with the new `project.read_financials` permission. `project-detail.html`'s own financial summary becomes a new, additive "Financials" tab (not a replacement of the Detail tab's existing Contract Value/Budget tiles).
| `project-physical.html` | `ACCEPT` | Progress timeline; title, percentage, note, actor/date | Project detail |
| `project-documentation.html` | `ACCEPT` | Category/search filters, document list, view/download/upload actions | Upload screen |
| `project-document-upload.html` | `ACCEPT` | File, category, document date, title, note, visibility | Documentation list |
| `project-expense.html` | `MINOR_CHANGE` | Date filters; category/detail/amount read-only project cost view — now the project detail page's own "Spend" tab (relabeled from "Expense" per ADR-089, to avoid confusion with the new Financials tab's ITC-excluded Recognized Expense figure), rolling up Purchase (finalized Vendor Bills), Reimbursement (approved/reimbursed Employee Expense Claims) and Direct Expense (posted Direct Expenses, added ADR-089); the prototype's other three categories (Employee Contribution, Server/Subscription, Introducer) are deferred until those modules reach this ledger (ADR-086), disclosed via an inline note rather than shown empty | Expense, purchase, salary, inventory, recurring-spend sources |
| `emdsd-all.html` | `MINOR_CHANGE` | Instrument/project/status/due filters; amount/entity/submitted/returned states | Add and project-scoped EMD/SD |
| `emdsd-add.html` | `FUNCTIONAL_CHANGE` | Project, instrument type/source, amount, reference, bank/authority, legal entity, dates, funding transfer | Banking masters and accounting rules |
| `project-emdsd.html` | `ACCEPT` | Project-scoped instrument table and Add action | Global EMD/SD list/add |
| `project-milestone.html` | `MINOR_CHANGE` | Separate CAPEX/OPEX cards and tables; event amount/due/achievement; frequency/installments/progress | Milestone add and complete income flow |
| `project-milestone-add.html` | `MINOR_CHANGE` | CAPEX pool/events; OPEX name, total, service dates, frequency, schedule, first invoice date, reminders | Milestone list, alert and invoice screens |

Milestone screens must be studied with section 11 of
`04-screen-contracts.md`. The prototype’s sample schedule totals and payment
status labels are not authoritative.

### 7.4 Finance — Income

Base path: `references/ui/html/04-finance-income/`

Always study all seven files together when implementing the first income
vertical slice. They represent one connected workflow, not seven isolated CRUD
pages.

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `project-payment-alert.html` | `MINOR_CHANGE` | Due-alert cards/list, recipient, due state, snooze, Raise Invoice action | Project milestones and invoice add |
| `project-invoice-add.html` | `MINOR_CHANGE` | Milestone/installment, number/date, billing entity, taxable amount, GST components, generated invoice, inward/supporting documents, note | Alert, invoice lists, receipt add |
| `project-invoices.html` | `MINOR_CHANGE` | Project filters/table, milestone, dates, taxable/GST/total, inward copy, settlement state | Global invoice list and Project tabs |
| `invoices-all.html` | `MINOR_CHANGE` | Project/client/status/date filters; invoice total, cash received, deductions, outstanding | Project invoice list, payment integration, aging reports |
| `project-payment-add.html` | `FUNCTIONAL_CHANGE` | Receipt mode, finalized invoice allocation, read-only invoice tax values, actual bank amount, TDS/GST-TDS, penalty, hold/retention, date/account/UTR/proof | Invoice add/list, banking masters, payment lists and deduction reports |
| `project-payment.html` | `MINOR_CHANGE` | Project receipt history, allocations, deductions, hold releases, settlement summaries | Payment add and global integration list |
| `payment-integration-all.html` | `MINOR_CHANGE` | Date/project/type/mode filters; invoice, base, TDS, GST-TDS, penalty, hold, actual bank receipt | Receipt screens, bank reconciliation, payment report |

Mandatory visual corrections from `04-screen-contracts.md`:

- “Upload Invoice” becomes “Raise Invoice.”
- CRM-generated tax invoice becomes Preview/Download Generated Invoice.
- Invoice values become read-only on the receipt screen.
- One receipt starts with one allocation row and supports Add another invoice.
- GST-TDS components, hold, retention, penalties, and other deductions remain
  separate.
- A Hold Release links to the original deduction.
- Invoice document status and settlement status are displayed separately.

### 7.5 Finance — Expense, procurement, employee claims, subscriptions, and servers

Base path: `references/ui/html/05-finance-expense/`

#### Procurement bundle

Revised Phase 6.4 (docs/12 ADR-079) — Purchase Request no longer exists as a
separate module; its three HTML prototypes now map directly onto Vendor
Bill's own pages instead of a `purchase-requests` route. Revised again Phase
6.5 (docs/12 ADR-080) — `purchase-payment.html`'s own mode/UTR/TDS/bank
fields, previously deferred, are now implemented, but on a new
`/vendor-payments` route (mirroring Client Receipt's own Record Payment
pattern) rather than on Vendor Bill's Approve action.

```text
purchase-list.html          → /vendor-bills (list)
purchase-request.html       → /vendor-bills/new (vendor/project/priority
                               entered directly, real line items + GST)
purchase-view.html          → /vendor-bills/[id] (draft edit, and the
                               decided/submitted maker-checker view)
NEW: optional PO
NEW: goods/service receipt
purchase-payment.html       → /vendor-payments/new + /vendor-payments/[id]
                               (bank account/mode/date/UTR, per-line cash
                               paid + TDS/GST-TDS deductions, ledger
                               posting) — seeded from an APPROVED Payment
                               Request's own "Record Payment…" action, not
                               from Vendor Bill directly
```

#### Employee expense/advance bundle

Phase 6.6 (docs/12 ADR-081) shipped the Employee Claim / Advance / Statement
half of this bundle first — Direct Expense (this bundle's own
`expense-add.html` "Direct Company Expense" branch) was confirmed deferred to
its own later slice, then built as its own follow-up (ADR-087, a new
`/direct-expenses` module, not a tab on `/employee-expenses`).

```text
expense-add.html          → /employee-expenses/my/new (Employee Claim branch)
                           → /direct-expenses/new (Direct Company Expense
                             branch — its own module, no employee/wallet
                             involvement)
→ expense-employee.html   → /employee-expenses (Accountant/Admin —
                             Approve/Reimburse row actions, Give Advance)
→ expense-employee-statement.html → /employee-expenses/my (self-service —
                             Statement/Pending-Claims tabs)
↘ expense-give-advance.html → /employee-expenses/give-advance
```

#### Subscription bundle

```text
subscriptions-all.html
→ subscription-add.html
→ subscription-view.html
→ subscriptions-dashboard.html
```

#### Server bundle

```text
servers-all.html
→ servers-add.html
→ server-view.html
```

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `purchase-list.html` | `MINOR_CHANGE` | Project/vendor/month filters; request, requester, estimate, GST, payment, source, state — now `/vendor-bills`' own list | Full procurement bundle |
| `purchase-request.html` | `MINOR_CHANGE` | Requirement, description, category, vendor, project, GST/ITC expectation, supply type, estimate, priority, invoice/quotation — now `/vendor-bills/new`'s own vendor/project/priority/GST-registration/line-item fields (real GST per line, not a lump estimate) | Vendor bill list/detail |
| `purchase-view.html` | `FUNCTIONAL_CHANGE` | Detail header, documents, approval/timeline and downstream actions — now `/vendor-bills/[id]`'s own draft-edit and decided/submitted maker-checker views | All procurement steps |
| `purchase-payment.html` | `FUNCTIONAL_CHANGE` | Read-only finalized bill, payment amount, GST display, TDS, mode, legal entity/account, date, UTR/proof/note — now `/vendor-payments/new` + `/vendor-payments/[id]` (bank account/mode/date/UTR, per-line cash paid + TDS/GST-TDS deductions, ledger posting; seeded from an APPROVED Payment Request's own "Record Payment…" action) | Payment Request detail page, vendor bill, and banking masters |
| `expense-add.html` | `FUNCTIONAL_CHANGE` | Direct expense vs employee claim, category, title, project/link, amount/date, GST/ITC, note and pending table — the Employee Claim branch is `/employee-expenses/my/new`; the Direct Company Expense branch is its own `/direct-expenses/new` (no maker-checker, confirmed via AskUserQuestion — a single `direct_expense.post` holder creates and posts, per docs/04's own "create/post" command pair; no Lead link target, same as Employee Claim; adds Payment Mode/Bank Account/Card fields the Employee Claim branch doesn't need, since it posts immediately). "Sub-category" is dropped on both (no backing master exists). The Direct Expense branch's own GST/TDS were later upgraded by ADR-088 (Subscription & Server) to a real CGST/SGST/IGST split + optional TDS, since every recurring-cycle payment posts through it — the Employee Claim branch keeps its original flat GST-credit amount | Employee claim screens, Direct Expense module, Subscription/Server modules, and category master |
| `expense-employee.html` | `MINOR_CHANGE` | Employee/category/project/status/date filters; claim review/approve/reimburse actions — now `/employee-expenses`' own filterable list with Approve/Reimburse row actions and a Give Advance button (summary tiles dropped — no accurate cross-page aggregate query exists yet) | Expense add, statement, advance |
| `expense-employee-statement.html` | `MINOR_CHANGE` | Employee/month; opening, advances, claims, reimbursement/recovery, running and closing balance — now `/employee-expenses/my`'s own self-service Statement/Pending-Claims tabs (resolves the acting user's own linked Employee record server-side, no employee picker) | Employee expense/advance screens |
| `expense-give-advance.html` | `MINOR_CHANGE` | Employee, amount/date, payment source/account, UTR/reference, purpose, optional project/note — now `/employee-expenses/give-advance`, with a server-computed wallet-impact preview | Employee statement and banking masters |
| `master-vendor.html` | `MINOR_CHANGE` | Vendor identity, GSTIN/PAN, city, terms, status | Vendor bill |
| `master-subscription-company.html` | `RETIRE` | Provider, category, website, status, usage count | Superseded (ADR-088) — Subscription reuses the existing Vendor/Party master directly, confirmed via AskUserQuestion; no dedicated provider master built |
| `master-server-provider.html` | `RETIRE` | Provider, type, region, status, server count | Superseded (ADR-088) — Server reuses the existing Vendor/Party master directly, same reasoning as `master-subscription-company.html` |
| `subscriptions-all.html` | `FUNCTIONAL_CHANGE` | Used-by/project/frequency filters; billing day, next due, forecast, cycle, monthly value, status | Built as `/subscriptions` (ADR-088) — forecast tiles (Active count, Monthly Run-rate, Annual Value, all computed server-side and labeled "Forecast"), no billing-day column (dropped per the plan's own recurrence simplification, see `subscription-add.html`) |
| `subscription-add.html` | `FUNCTIONAL_CHANGE` | **Canonical** subscription create/edit form: title, provider/vendor, frequency, billing day, start, estimate, project, users, status, notes | Built as `/subscriptions/new` (ADR-088) — vendor/category/project/used-by/frequency/first-due-date/start-end-dates/approximate-amount/note; no separate "billing day" field — an exact `firstDueDate` plus calendar-safe stepping (reusing the OPEX engine's `addMonthsClamped`) replaces it entirely, per the review's own explicit instruction not to restrict billing days to avoid month-end logic |
| `subscription-view.html` | `FUNCTIONAL_CHANGE` | Subscription detail and billing-cycle table; due date, actual amount, payer/source, transaction and invoice | Built as `/subscriptions/[id]` (ADR-088) — a cycle table (period/due date/status/amount) with an inline Record Payment modal (posts a real Direct Expense with full GST/TDS/Card fields) and explicit Pause/Resume/Cancel actions |
| `subscriptions-add.html` | `RETIRE` | Compare payment-source fields only; do not build a second create route | Confirmed a genuinely different, older duplicate of `subscription-add.html` — retired, not built |
| `subscriptions-dashboard.html` | `NOT_BUILT` | Payment/project/sort filters; provider share and forecast-versus-actual summaries | Explicitly deferred (ADR-088) — a follow-up reporting screen, same precedent as the Employee Expenses stats-tiles deferral (ADR-085) |
| `servers-all.html` | `FUNCTIONAL_CHANGE` | Manager/project/frequency filters; provider, projects, next due, recurring value, status | Built as `/servers` (ADR-088) — same forecast-tile shape as Subscriptions, plus an associated-projects column |
| `servers-add.html` | `FUNCTIONAL_CHANGE` | Provider, title, projects, manager, region, approximate amount, frequency/billing dates, start, status | Built as `/servers/new` (ADR-088) — legal entity is always explicit (never derived — a server can serve projects spanning legal entities), a multi-select project chip picker scoped to that legal entity, Weekly frequency rejected |
| `server-view.html` | `FUNCTIONAL_CHANGE` | Operational detail and recurring billing cycles; actual amount, payer/source, transaction/reference/invoice | Built as `/servers/[id]` (ADR-088) — adds an associated-projects manager and a "charge to project or company overhead" selection on Record Payment, since one server can serve multiple projects and a cycle's cost is never implicitly split |

Approval Queue, optional PO, and Goods/Service Receipt screens are
`NEW_REQUIRED`. Vendor Bill, Payment Request, and Vendor Payment (Phase 6.5,
docs/12 ADR-080) are built. Employee Claim/Advance/Statement (Phase 6.6,
docs/12 ADR-081) is built; Direct Expense remains deferred to its own slice.
Preserve the Purchase View visual language when creating the remaining
missing steps.

### 7.6 HR, salary import, and project allocation

Base path: `references/ui/html/06-hr-payroll/`

Canonical workflow:

```text
employee-master.html
→ employee-salary-upload.html
→ employee-effort-entry.html
→ employee-effort-summary.html
→ employee-manpower-cost.html
```

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `employee-master.html` | `FUNCTIONAL_CHANGE` | Employee identity, optional user link, role/department, reimbursable setting, displayed salary, joining date, status | Salary import and Users/RBAC |
| `employee-salary-upload.html` | `MINOR_CHANGE` | Month/file upload, preview grid, employee matching, gross/deductions/net display, commit action | Employee master and allocation entry |
| `employee-effort-entry.html` | `MERGE` | **Canonical** monthly project/internal allocation grid, month/team filters and total percentage | Contribution entry and allocation summary |
| `employee-contribution-entry.html` | `RETIRE` | Useful contribution notes/metrics only; no second percentage truth | Merge into canonical effort/allocation entry |
| `employee-effort-summary.html` | `MINOR_CHANGE` | Rename Allocation Summary; month range/project filters and employee allocation grid | Canonical allocation entry |
| `contribution-dashboard.html` | `MERGE` | Allocation/contribution KPI and trend presentation | Allocation records and summaries |
| `employee-manpower-cost.html` | `MINOR_CHANGE` | Month range/project filters and allocated employee salary cost grid | Salary imports, submitted allocations, Project P&L |

Imported monthly gross salary is the historical costing source. Allocation must
total exactly 100% across projects and approved internal/bench targets.

### 7.7 Inventory

Base path: `references/ui/html/07-assets-inventory/`

Despite the folder name, there is no Fixed Asset register or depreciation
module.

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `master-product.html` | `MINOR_CHANGE` | Product, unit, HSN/SAC, rate, category, stock-tracked flag, status | All inventory screens |
| `inventory-list.html` | `MINOR_CHANGE` | Category/stock/search filters; product, total in/out, on-hand and stock value | Product master and item detail |
| `inventory-detail.html` | `MINOR_CHANGE` | Vendor/date filters; stock-in and project-consumption ledgers with running balance | Receipt and consumption forms |
| `inventory-add-stock.html` | `FUNCTIONAL_CHANGE` | Vendor, approved purchase/bill link, received date, invoice/challan and item lines/attachment | Procurement and inventory detail |
| `inventory-add-consumption.html` | `MINOR_CHANGE` | Project, issue date, issuer, reference/indent, note and item/quantity rows | Inventory detail and Project cost |

### 7.8 Banking masters

Base path: `references/ui/html/08-banking/`

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `master-bank.html` | `ACCEPT` | Bank name, IFSC prefix, status, account count | Bank account |
| `master-bank-account.html` | `MINOR_CHANGE` | Account label, bank, masked number, IFSC, owning legal entity, status | Invoice receipt and all payment forms |
| `master-credit-card.html` | `FUNCTIONAL_CHANGE` | Card label, masked number, bank, owning legal entity, status | Built as part of `/card-accounts` (ADR-088) — a single `CardAccount` master covers both Debit and Credit Card (type-discriminated, not two separate screens); Credit Card additionally carries its own payable ledger account and a Settle action, since a Credit Card purchase is a liability, not an immediate bank debit |
| `master-upi.html` | `MINOR_CHANGE` | UPI label/VPA, linked legal-entity bank account, status | Expense/subscription/introducer payment sources |

No HTML currently exists for bank-statement import, transaction matching, or
reconciliation. Those are `NEW_REQUIRED` screens and must follow the existing
filter-card, table, summary, drawer, and confirmation patterns.

### 7.9 Introducer fee

Base path: `references/ui/html/09-introducer-fee/`

| HTML file | Treatment | Fields/UI to study | Read together with |
|---|---|---|---|
| `master-introducer.html` | `MINOR_CHANGE` | Name, phone, payout mode/detail, PAN, status, project count | Agreement/accrual and payment |
| `introducer-all.html` | `MINOR_CHANGE` | Introducer/project/status filters; accrued, paid, TDS, advance and payable balances | Add and payment screens |
| `introducer-fee-add.html` | `MINOR_CHANGE` | Project, introducer lines, basis/rate/amount, agreement date and remarks | Introducer list/master |
| `introducer-fee-payment.html` | `FUNCTIONAL_CHANGE` | Introducer/project, allocation to accruals, amount/date, mode/source account, TDS, UTR/reference/note | Banking masters and introducer statement |

### 7.10 Reports

Base path: `references/ui/html/10-reports/`

All reports are read-only. Study `reports-all.html` for the catalogue and
`dashboard.html` for summary-card behavior. Every report requires consistent
filters, backend-owned totals, source drill-down, export, loading, empty, error,
permission, and unreconciled-data states.

| HTML file | Treatment | Fields/UI to study | Primary authoritative sources |
|---|---|---|---|
| `reports-all.html` | `MINOR_CHANGE` | Permission-aware report catalogue, categories, search/tiles | Report metadata |
| `report-business-overview.html` | `FUNCTIONAL_CHANGE` | Period/project summary grid: earning, effort, expense, purchase, recurring, introducer, cost, profit/loss | Posted journals plus clearly labelled operational/budget metrics |
| `report-project-pl.html` | `MINOR_CHANGE` | Project/period P&L header, revenue/cost sections and drill-down | Posted journal dimensions |
| `report-earning.html` | `FUNCTIONAL_CHANGE` | Type/status/period filters; value, cash received, expense, profit, margin | Explicitly defined cash profitability/contribution basis |
| `report-cost-to-company.html` | `MINOR_CHANGE` | Project/type/period filters; manpower, expenses, purchases, recurring and introducer cost | Posted costs plus approved analytical allocations |
| `report-cash-flow.html` | `MINOR_CHANGE` | Account/month filters; opening, inflow, outflow, closing and trend | Bank/cash transactions and matched postings |
| `report-aging.html` | `MINOR_CHANGE` | Type/project/as-of filters and 0–30/31–60/61–90/90+ buckets | Finalized invoice due dates; separate hold/retention aging |
| `report-outstanding-summary.html` | `MINOR_CHANGE` | Summary cards and drill-down for invoices, TDS/GST-TDS, holds/retention, disputed items | Invoice settlement and deduction records |
| `report-pending-invoice.html` | `MINOR_CHANGE` | Project/client/aging/date filters; invoice, due date, total, received, outstanding, age/state | Finalized invoices and receipt allocations |
| `report-payment.html` | `MINOR_CHANGE` | Project/mode/date filters; receipt, invoice settlement, taxes/deductions, actual bank amount | Client receipts and allocations |
| `report-payment-hold.html` | `MINOR_CHANGE` | Project/status/period; original hold, releases, outstanding and last release | Hold/retention deductions and linked releases |
| `report-penalty.html` | `MINOR_CHANGE` | Project/category/period; invoice/date/amount/reason and resolution state | Typed receipt deductions |
| `report-gst-output.html` | `MINOR_CHANGE` | Project/GST type/period; invoice, GSTIN/client, taxable and component taxes | Finalized sales invoices and notes |
| `report-gst-input.html` | `MINOR_CHANGE` | Vendor/invoice/project/period; GSTIN, taxable, components, document/eligibility state | Finalized vendor bills and ITC classification |
| `report-gst-net.html` | `FUNCTIONAL_CHANGE` | Period/component summary; output, eligible input, adjustments and net | GST ledgers and tax documents |
| `report-gstr-register.html` | `MINOR_CHANGE` | Register/type/period; document, GSTIN/party, taxable/rate/GST/type | Invoice, vendor-bill and credit/debit-note tax lines |
| `report-tds-inward.html` | `MINOR_CHANGE` | Client/project/26AS/period; receipt, base/rate, deduction, certificate/FY | Client receipt deductions and certificates |
| `report-tds-outward.html` | `MINOR_CHANGE` | Vendor/section/period; payment, PAN, base/rate/TDS/challan | Vendor/introducer payment deductions |
| `report-tds-recon.html` | `FUNCTIONAL_CHANGE` | Prototype is incomplete; retain shell/table language but create full match, partial, exception, certificate and 26AS workflow | Internal deductions and imported certificate/26AS records |
| `report-expense.html` | `MINOR_CHANGE` | Project/category/period; purchases, manpower, servers, subscriptions, reimbursements, introducer and total | Posted expense sources |
| `report-vendor-payment.html` | `MINOR_CHANGE` | Vendor/project/mode/period; payment, bill base/GST, TDS and net bank | Vendor payments and allocations |
| `report-reimbursement.html` | `MINOR_CHANGE` | Employee/status/project/period; claim/date/amount/state | Expense claims, approvals, advances and settlements |
| `report-employee-wallet.html` | `FUNCTIONAL_CHANGE` | Rename Employee Advance Report; employee/balance/period, advances, claims, reimbursement and closing state | Employee advance control records; no wallet product |
| `report-recurring-spend.html` | `MINOR_CHANGE` | Kind/provider/project/payment-source filters; item, frequency, monthly/yearly forecast and actual | Subscription/server cycles and posted spend |
| `report-manpower-utilization.html` | `MINOR_CHANGE` | Employee/department/month; allocated %, capacity, variance and state | Submitted/locked monthly allocations |
| `report-emd-recovery.html` | `MINOR_CHANGE` | Type/project/status/due filters; instrument, amount, submitted/due/returned | EMD/SD lifecycle and postings |
| `report-introducer-statement.html` | `MINOR_CHANGE` | Introducer/period; date/project/particular, accrual, TDS, payment and balance | Introducer accrual/payment allocations |

## 8. Shared component extraction map

Do not convert 103 business HTML files into 103 isolated visual
implementations. Extract these shared components while preserving each target
screen’s composition:

| Shared component | Primary HTML references |
|---|---|
| Application shell and navigation | `01-platform/shell.html` |
| Page header and project record header | `03-projects/project-detail.html`, all Project tabs |
| Master form/list layout | `01-platform/master-state.html`, `master-city.html` |
| Filter card and server-side table | `02-crm/client-list.html`, `03-projects/project-list.html` |
| Two-column business form | `02-crm/client-add.html`, `03-projects/project-add.html` |
| Tabbed detail page | `02-crm/lead-view-detail.html`, `03-projects/project-detail.html` |
| Document upload/list | Lead and Project document screens |
| Timeline | `02-crm/lead-view-updates.html`, `03-projects/project-physical.html` |
| Financial document form | `04-finance-income/project-invoice-add.html` |
| Financial allocation/calculation panel | `04-finance-income/project-payment-add.html` |
| Approval/detail timeline | `05-finance-expense/purchase-view.html` |
| Recurring-cycle table | `subscription-view.html`, `server-view.html` |
| Allocation matrix | `06-hr-payroll/employee-effort-entry.html` |
| Inventory movement ledger | `07-assets-inventory/inventory-detail.html` |
| Report filters, KPI summary, table and export | `10-reports/report-aging.html`, `report-project-pl.html` |

Ant Design owns accessible component behavior. Tailwind owns layout,
responsive grids, spacing, and small presentation utilities. Central design
tokens from `15-ui-design-system.md` must override generic Ant Design styling.

## 9. Per-task reference declaration

Every frontend task plan must contain this block before implementation:

```text
Target production screen:
Target HTML:
Target screenshot:
Shared shell reference:
Related workflow HTML:
Screen-contract section:
UI-design-system sections:
Prototype fields retained:
Prototype fields renamed:
Required new fields:
Fields made read-only:
Prototype fields removed/merged:
Known sample calculations ignored:
Shared components reused/created:
```

Example for invoice creation:

```text
Target production screen: Project Invoice Create
Target HTML: references/ui/html/04-finance-income/project-invoice-add.html
Target screenshot: references/ui/screenshots/04-finance-income/project-invoice-add.png
Shared shell reference: references/ui/html/01-platform/shell.html
Related workflow HTML:
  - references/ui/html/03-projects/project-milestone.html
  - references/ui/html/03-projects/project-milestone-add.html
  - references/ui/html/04-finance-income/project-payment-alert.html
  - references/ui/html/04-finance-income/project-invoices.html
  - references/ui/html/04-finance-income/project-payment-add.html
Screen-contract section: 11.4
```

## 10. Completion checklist

A module’s HTML-reference work is complete only when:

- all expected prototype files have been copied and counted;
- every implemented screen names its target and related HTML files;
- every visible prototype field is retained, changed, or rejected explicitly;
- duplicate/retired screens have not created duplicate production workflows;
- the shared shell and component patterns are reused;
- the paired screenshot has been compared at the agreed viewport;
- business, accounting, authorization, accessibility, and responsive
  corrections from the Markdown contracts are implemented;
- sample HTML calculations are not used as authoritative formulas;
- the production result remains recognizably faithful to the prototype.

