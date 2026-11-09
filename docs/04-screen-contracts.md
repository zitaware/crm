# Screen Contracts

Status: `DEVELOPMENT_BASELINE`

## 1. Purpose and authority

This document maps the supplied HTML prototype to implementation behavior. It is the acceptance baseline for frontend routes, API procedures, permissions, domain writes, accounting effects, audit events and tests.

The HTML files are authoritative for:

- information hierarchy;
- intended fields and labels;
- module navigation and general layout;
- user workflow intent;
- list, detail, form and report presentation.

The HTML files are not authoritative for:

- database table boundaries;
- accounting calculations;
- authorization;
- state transitions;
- sample totals or statuses;
- frontend source-code structure;
- accessibility or responsive behavior.

When a visual field conflicts with a confirmed business rule, accounting integrity, tax treatment, reconciliation or security, this document takes precedence. Preserve the visual design as closely as practical and apply the smallest necessary UI correction.

## 2. Prototype coverage

The supplied set contains 106 HTML files:

- 103 business screens;
- `01-platform/index.html` as an entry/navigation prototype;
- `01-platform/shell.html` as a layout prototype;
- `01-platform/fonts.html` as a typography reference.

The three reference files are not production routes. All 103 business screens are accounted for below, either as retained, changed, merged, retired or replaced.

## 3. Contract format

Every production screen must have a route-level contract containing:

| Contract item | Required definition |
|---|---|
| Route | Stable Next.js route and route parameters |
| Purpose | One clear user outcome |
| Query | Screen-specific read model; no table-shaped generic API |
| Command | Business-intent command; no generic mutation for posted finance |
| Permission | Server-enforced `resource.action`; UI hiding is supplementary |
| Validation | Shared Zod schema plus server business validation |
| State transition | Explicit allowed source and target states |
| Domain effect | Aggregate records created/changed atomically |
| Journal effect | Posting rule or explicit `none` |
| Audit effect | Business event, actor, source, reason and correlation ID |
| Error states | Validation, forbidden, not found, conflict and retry behavior |
| Acceptance tests | Happy path, rejection path, permission and concurrency checks |

## 4. Disposition vocabulary

| Disposition | Meaning |
|---|---|
| `ACCEPT` | Structure and behavior can be implemented substantially as shown |
| `MINOR_CHANGE` | Keep visual structure; correct labels, fields or behavior |
| `FUNCTIONAL_CHANGE` | Keep visual intent, but backend behavior/form composition must change |
| `MERGE` | Preserve useful UI elements in another canonical screen |
| `RETIRE` | Do not implement as an independent production route |
| `NEW_REQUIRED` | No suitable HTML exists; design in the same visual system |
| `REFERENCE_ONLY` | Design reference, not a production screen |

## 5. Global UI contract

### 5.1 Shared frontend implementation

- Use Ant Design for forms, tables, drawers, modals, steps, date controls, uploads, pagination and feedback.
- Use Tailwind CSS for layout, responsive grids, spacing and small presentation utilities.
- Use Redux Toolkit only for justified cross-screen client state. API records remain in the tRPC query cache.
- Follow `15-ui-design-system.md` for the exact HTML-derived visual tokens,
  component proportions, layout patterns, responsive rules and screenshot
  acceptance process.
- Build shared page shells, tabs, filters, tables, form sections, money inputs, GST controls, file uploads and status badges.
- Do not copy CSS or JavaScript separately from each HTML page.
- Replace prototype branding and sample names such as Sthapatya or Exilio with configurable Zitaware Solutions organization data.

### 5.2 Shared route and navigation behavior

- Centralize route definitions; do not use filename-relative navigation.
- Build navigation from permission-aware route metadata.
- Preserve project tabs through nested project routes.
- Preserve list filters in the URL so refresh, sharing and browser navigation work.
- Use breadcrumbs and a consistent Back action; never rely only on browser history.
- Block direct route access on the server when permission or project scope is missing.

### 5.3 Shared list contract

All list screens must provide:

- server-side filtering, stable sorting and pagination;
- loading, empty, error and no-permission states;
- a clear reset-filter action;
- permission-controlled create/export/actions;
- masked sensitive values;
- export using the same filters and authoritative backend query;
- row actions that route to the correct detail screen;
- deterministic row keys and accessible table labels.

### 5.4 Shared form contract

All create/edit screens must:

- use proper labels, names and accessible descriptions;
- validate on the client for feedback and again on the server for authority;
- show field errors separately from business-rule errors;
- prevent accidental double submission;
- preserve a draft only where the workflow supports drafts;
- use optimistic concurrency for mutable existing records;
- warn before abandoning unsaved changes;
- upload documents through the approved document service;
- display server-calculated money/tax previews before confirmation.

### 5.5 Shared financial contract

- Use backend-returned Decimal values as canonical.
- Never calculate authoritative GST, TDS, outstanding, settlement, schedule or journal totals in page code.
- Format INR using Indian digit grouping while transmitting decimal strings.
- Display business dates without timezone conversion and event times in Asia/Kolkata.
- Posted documents are read-only.
- Correction actions must request a reason and create reversal/replacement records.
- Every financial submit command uses an idempotency key.

### 5.6 Shared error and confirmation states

Every command screen must explicitly handle:

- `VALIDATION_FAILED`;
- `FORBIDDEN`;
- `NOT_FOUND`;
- `VERSION_CONFLICT`;
- `INVALID_STATE_TRANSITION`;
- `ACCOUNTING_PERIOD_LOCKED`;
- applicable allocation, numbering, maker-checker and idempotency errors.

Financial confirmation dialogs must show the document, legal entity, business date, total, accounting consequence and whether the action becomes immutable.

## 6. Permission convention

Use lower-case domain resources and explicit actions, for example:

- `client.read`, `client.create`, `client.update`, `client.export`;
- `project.read`, `project.create`, `project.change_stage`;
- `invoice.read`, `invoice.create`, `invoice.finalize`, `invoice.void`;
- `receipt.read`, `receipt.post`, `receipt.reverse`;
- `purchase_request.submit`, `purchase_request.approve`;
- `vendor_bill.finalize`, `vendor_payment.post`;
- `report.financial.read`, `report.financial.export`;
- `master.manage`, `user.manage`, `accounting_period.lock`.

Project Manager access is restricted to assigned projects where the rule applies. Accountant and Admin access remains organization/legal-entity scoped. Permissions are enforced in the API for queries, commands, file access and exports.

## 7. Reference and shell files

| HTML file | Disposition | Production treatment |
|---|---|---|
| `01-platform/index.html` | `REFERENCE_ONLY` | Use only to understand the prototype entry experience. Production entry redirects to authenticated dashboard. |
| `01-platform/shell.html` | `REFERENCE_ONLY` | Convert its layout intent into shared Next.js root/module layouts and permission-aware navigation. |
| `01-platform/fonts.html` | `REFERENCE_ONLY` | Use as typography reference; configure fonts and tokens centrally. |

## 8. Platform and master screens

### Shared master behavior

Master forms use `master.read` and `master.manage`. Create/update/deactivate actions validate uniqueness, dependency rules and active references. Referenced masters are deactivated rather than deleted. Every mutation writes `master.created`, `master.updated` or `master.deactivated`; journal effect is none.

Phase 2.11 implementation notes (ADR-044): the `masters-all` catalogue tile count is the number of records in each master (`masters.getCatalog` / `geography.getCounts`); the per-master list's prototype "usage count" column (dependent leads/projects/employees) is omitted until those dependents exist (Phase 3). Geography (State/District/City) is editable — `master.manage`-gated create/update/deactivate — reversing ADR-036's read-only stance so administrators can add districts/cities the partial seed omits; a geography row's parent is fixed at creation (update changes name only). Add/edit uses a form drawer (docs/16 §7.1's permitted equivalent to the prototype's inline form). `payment_modes` and `document_categories`' entity-type applicability are deferred to their own follow-ups.

| HTML file | Disposition | Screen contract |
|---|---|---|
| `01-platform/dashboard.html` | `MINOR_CHANGE` | Query `dashboard.getOverview`; permission `dashboard.read`. Filters select legal entity and business period. Every card links to its source report. Values are derived from posted journals and authoritative operational read models; no screen-local profit formula. Test card-to-report reconciliation and scoped access. |
| `01-platform/masters-all.html` | `ACCEPT` | Query `master.getCatalog`; permissions determine visible tiles. Export is restricted and audited as `master.catalog_exported`. Add tiles for Legal Entities, GST Registrations, Users/Roles and accounting masters when implemented. |
| `01-platform/master-state.html` | `MINOR_CHANGE` | Manage state name, code and GST state code. GST state code is unique and immutable once referenced by finalized tax documents. |
| `01-platform/master-district.html` | `ACCEPT` | Manage district under an active state; unique by state and normalized name. |
| `01-platform/master-city.html` | `ACCEPT` | Manage city under active district/state; validate hierarchy rather than accepting inconsistent independent values. |
| `01-platform/master-expense-category.html` | `MINOR_CHANGE` | Manage expense category and classification. Add default ledger account/tax behavior through accountant-only configuration, not the ordinary form when unnecessary. |
| `01-platform/master-lead-type.html` | `ACCEPT` | Manage lead types used by Lead records. Deactivation must not alter historical leads. |
| `01-platform/master-penalty-category.html` | `MINOR_CHANGE` | Manage category and default basis; accepted/disputed accounting accounts are configured separately. Historic receipt deductions preserve a snapshot. |
| `01-platform/master-project-type.html` | `ACCEPT` | Manage project type and commercial classification. Existing projects preserve their selected value after deactivation. |
| `02-crm/master-company.html` | `FUNCTIONAL_CHANGE` | Reuse visual layout for the simple Legal Entity screen. A legal entity has registrations and bank accounts; do not store one GSTIN/bank account directly on the company row. Commands: `legalEntity.create/update/deactivate`, `gstRegistration.create/update/deactivate`. Permissions: `legal_entity.read/manage`. Audit every change. Implemented: `setActive`/`setGstRegistrationActive` serve the activate/deactivate intent (consistent with every other module's convention); GST Registrations are a per-entity sub-list off the entity's edit drawer, not flattened into the top-level table; bank accounts deferred (no master exists yet) — see ADR-048. Real `delete` also implemented (soft-delete, frees the PAN/GSTIN for reuse, blocked while GST registrations/financial years still exist) — see ADR-049. Logo, seal, and authorized sign are optional PNG or JPEG images on the entity (ADR-141) and print on the invoice. |
| `05-finance-expense/master-server-provider.html` | `ACCEPT` | Provider party/master used by servers. Prefer linking to a party/vendor profile while preserving provider-specific classification. |
| `05-finance-expense/master-subscription-company.html` | `ACCEPT` | Subscription provider master; prefer a party/vendor link so tax and payment details are not duplicated. |
| `05-finance-expense/master-vendor.html` | `MINOR_CHANGE` | Visual form remains. Internally create/update a Party plus Vendor Profile, GST registrations, addresses and payment terms. PAN/GSTIN validation and duplicate-party warning are mandatory. |
| `07-assets-inventory/master-product.html` | `MINOR_CHANGE` | Manage stock-tracked item, unit, HSN/SAC, category and optional default rate. Add `is_stock_tracked`; no fixed-asset classification/depreciation workflow. |
| `08-banking/master-bank.html` | `ACCEPT` | Manage bank reference records. IFSC prefix is informational and cannot replace full IFSC validation. |
| `08-banking/master-bank-account.html` | `MINOR_CHANGE` | Account belongs to one legal entity. Store full account securely; show masked value. Validate IFSC, account uniqueness and active ledger mapping. |
| `08-banking/master-credit-card.html` | `MINOR_CHANGE` | Card belongs to one legal entity and bank account/payable ledger. Never store CVV; retain only permitted masked/reference data. |
| `08-banking/master-upi.html` | `MINOR_CHANGE` | UPI ID belongs to a legal-entity bank account; validate linked account and mask where required. |
| `09-introducer-fee/master-introducer.html` | `MINOR_CHANGE` | Internally manage Party plus Introducer Profile. Validate PAN and payout details; sensitive values are permission-scoped and masked. |

## 9. CRM screens

| HTML file | Disposition | Query/command and permission | Domain, audit and acceptance |
|---|---|---|---|
| `02-crm/client-list.html` | `ACCEPT` | `client.list`; `client.read/export/create` | Query Party + Client Profile read model with state/department/date filters. Export uses identical filters and is audited. Test permission scope and correct View route. |
| `02-crm/client-add.html` | `MINOR_CHANGE` | `client.create/update`; `client.create/update` | Atomically create Party, Client Profile and address. Validate organization name and address hierarchy. Department is optional (ADR-123). A client GSTIN, when captured, is stored as entered with no character-pattern check (ADR-130). Contact persons and notes are not on the client (ADR-144). Audit `client.created/updated`; no journal. |
| `02-crm/client-view.html` | `MINOR_CHANGE` | `client.getDetail`; `client.read/update` | Show identity, address, Leads, Tenders, Projects and financial summary. Contact persons and notes are not shown (ADR-144). Financial summary comes from read models; it is not editable. |
| `02-crm/lead-list.html` | `MINOR_CHANGE` | `lead.list`; `lead.read/export/create` | Preserve filters. Lead stage values must come from the Lead state machine, not Project stages. Export audited. |
| `02-crm/lead-add.html` | `MINOR_CHANGE` | `lead.create/update`; `lead.create/update` | Create Lead linked to client and optional introducer. Store estimated value as non-accounting data. Validate dates and active references. Audit `lead.created/updated`. |
| `02-crm/lead-view-detail.html` | `MINOR_CHANGE` | `lead.getDetail`, `project.createFromLead`; `lead.read/update`, `project.create` | Keep tabs and Convert action. Conversion creates a Project with origin Lead reference and snapshots approved fields; it does not delete/overwrite the Lead. Duplicate conversion requires confirmation/rule. |
| `02-crm/lead-view-documents.html` | `ACCEPT` | `document.list/link`; `lead.read`, `document.upload` | Store document and link it to Lead. Validate file policy and parent permission. Audit upload/download/delete/version actions. |
| `02-crm/lead-view-updates.html` | `ACCEPT` | `leadUpdate.list/create`; `lead.read/update` | Append timeline updates with actor and timestamp. Corrections remain auditable; no journal. |

Phase 3.1 implementation notes (ADR-053): `client-list.html`/`client-add.html`/`client-view.html`'s Party+Client Profile split is implemented literally as two Prisma models (`Party`+`ClientProfile`) plus a `Contact` child table for the repeatable contact rows — no PAN field (PAN belongs to `LegalEntity`, our own entity, not a client), GSTIN added as optional (a real gap between `client-add.html`'s form and `client-view.html`'s mock data, closed per ADR-053 item 3). `client-view.html`'s GST-registrations/Leads/Tenders/Projects sections are not yet built — `ClientDetail` composes only what exists this slice (Party+ClientProfile+Contacts); Leads/Projects sections are added in their own future slices once those aggregates exist, per every prior Phase 2.11 family's "omit dependent data until the dependent exists" precedent. Client type is `ClientType`, a new generic lookup master (not a reuse of `GovernmentBodyType`) — see ADR-053 item 2. No delete path this slice (ADR-053 item 6); `client.delete`/`client.manage` are not implemented, only `client.read`/`client.create`/`client.update`/`client.export`(export itself deferred, consistent with every Phase 2 screen).

Phase 3.2 implementation notes (ADR-054): `lead-add.html`'s "optional introducer" is a new, deliberately minimal `Introducer` table (name/phone only), not the full Party+IntroducerProfile entity `09-introducer-fee/master-introducer.html` describes — that PAN/payout/masked entity plus its agreement/accrual/payment workflow is Phase 7 scope. The three non-reconciling status vocabularies visible across `lead-list.html`/`lead-add.html`/`client-view.html`'s Leads mini-list collapse to one stored field, `Lead.stage` (7 values); every other status label shown anywhere is a pure derived mapping, never stored. `lead-view-detail.html`'s "Convert to Project" button is omitted entirely (not even disabled) — Project doesn't exist until a future slice. An `assignedToEmployeeId` field not present anywhere in the HTML was added to resolve the prototype's own inconsistency (`lead-view-detail.html` shows "Introducer: ..." in its meta strip; `lead-view-documents.html`/`lead-view-updates.html` show "Owner: Alkesh" for the same lead) — both Introducer and Assigned To are now always shown together. `lead-view-documents.html`'s "Title"/"Note" fields on the upload form were dropped — the underlying `DocumentSummary` type has no fields to hold them. No Lead ID/code anywhere (`Lead.id` is a plain UUID, matching `Party`'s own precedent) and no automated duplicate-lead detection. `client-view.html`'s embedded "Leads" mini-list is not yet wired — `client-view.html` itself was never built as its own route (Client has only a list+edit-drawer so far); deferred to a fast-follow once a real Client detail page exists.

### Tender UI missing from prototype

Tender and Lead are separate upstream modules. Before Project development is complete, add `NEW_REQUIRED` Tender list, add/edit, detail, documents/updates and conversion/linking screens. Follow the Lead visual system but use Tender-specific dates, authority, tender number, value, submission status, result and EMD/SD links. A Project may reference a Lead, Tender or both.

## 10. Project screens

| HTML file | Disposition | Query/command and permission | Domain, audit and acceptance |
|---|---|---|---|
| `03-projects/project-list.html` | `MINOR_CHANGE` | `project.list`; `project.read/export/create` | Keep filters; show Stage and Operational Status separately. Scope Project Manager results to assignments. Export audited. |
| `03-projects/project-add.html` | `MINOR_CHANGE` | `project.create/update`; `project.create/update` | Preserve fields. Add/retain independent origin Lead and Tender, owning legal entity, client, value, budget, GST applicability and Project Manager. Default stage/status per approved workflow. Estimated budget is not an accounting posting. |
| `03-projects/project-detail.html` | `MINOR_CHANGE` | `project.getDetail`; `project.read/update/change_stage/change_status` | Summary is derived from project, milestones, invoices, receipts, costs and journals. Stage/status transitions use explicit commands with reason where required. Test totals against source reports. |
| `03-projects/project-physical.html` | `ACCEPT` | `projectProgress.list/create`; `project.read`, `project_progress.create` | Append progress updates with percentage, title and note. Validate 0–100, business date/order and project status. Audit create/correction. No journal. |
| `03-projects/project-documentation.html` | `ACCEPT` | `document.list`; `project.read`, `document.download/upload` | Preserve category/search/view/download. Enforce project scope and document visibility. Audit sensitive download/export. |
| `03-projects/project-document-upload.html` | `ACCEPT` | `document.upload/link`; `document.upload` | Keep fields; validate file, category, date and visibility. Upload completion and link occur safely; failed upload leaves no active document link. |
| `03-projects/project-expense.html` | `MINOR_CHANGE` | `projectCost.getExpenseSummary`; `project.read`, `expense.read` | Read-only project cost view from posted expenses, vendor bills, salary allocation, inventory consumption and introducer accrual. No independent expense calculation or write. |
| `03-projects/emdsd-all.html` | `MINOR_CHANGE` | `securityInstrument.list`; `security_instrument.read/export/create` | Support Tender, Project or both; filter by instrument/status/due date. Overdue and exposure totals derive from instrument lifecycle. |
| `03-projects/emdsd-add.html` | `FUNCTIONAL_CHANGE` | `securityInstrument.create/lodge`; `security_instrument.create/post` | Preserve instrument and transfer fields. Add source type: cash, bank guarantee or other. Cash lodging posts recoverable/bank journal; BG principal is contingent while margin/charges use separate postings. Validate legal entity and source account. |
| `03-projects/project-emdsd.html` | `ACCEPT` | Project-scoped `securityInstrument.list`; `project.read`, `security_instrument.read/create` | Same aggregate as all-EMD/SD screen, filtered by project. Never duplicate project-specific records. |

## 11. Milestone-to-receipt priority flow

This is the first complete financial vertical slice. The required sequence is:

```text
CAPEX milestone/event ─┐
                      ├─→ Payment Alert → Draft Invoice → Finalized Invoice
OPEX installment ─────┘                                      ↓
                  Client Receipt → Invoice Allocation → Typed Deductions
                                      ↓
                           Journal + Bank Reconciliation
```

### 11.1 `03-projects/project-milestone.html`

Disposition: `MINOR_CHANGE`

Keep:

- project header and tabs;
- CAPEX and OPEX summary cards;
- separate CAPEX and OPEX tables;
- Add CAPEX/Add OPEX actions;
- CAPEX event values/due dates;
- OPEX frequency, duration, installment count, approximate installment, next invoice date and progress.

Correct:

- show Achievement Status separately from derived Billing Status;
- replace “raised” with “invoiced”;
- label per-installment value as approximate when final rounding differs;
- show payment only by drilling into invoices/receipts, not as milestone state.

Contract:

| Item | Definition |
|---|---|
| Query | `milestone.getProjectSummary`, `milestone.getOpexSchedule` |
| Commands | `milestone.markAchieved`, `milestone.cancel` where allowed |
| Permissions | `milestone.read/create/update/mark_achieved/cancel` |
| Domain effect | Milestone state only; billing state is derived |
| Journal | None |
| Audit | `milestone.achievement_changed`, `milestone.cancelled` |
| Acceptance | CAPEX/OPEX totals reconcile, derived statuses match invoices, unauthorized actions hidden and rejected |

### 11.2 `03-projects/project-milestone-add.html`

Disposition: `MINOR_CHANGE`

CAPEX:

- create a CAPEX milestone/pool with one or more approved event rows;
- event total cannot exceed approved CAPEX unless an approved amendment/additional-work milestone exists;
- saving creates no receivable or journal.

OPEX:

- create one duration-based milestone;
- use service start, service end, frequency and first planned invoice date;
- generate deterministic installment periods and scheduled taxable amounts;
- put rounding remainder into the final installment;
- schedule rows create reminders only, never invoices or revenue.

| Item | Definition |
|---|---|
| Commands | `milestone.createCapex`, `milestone.createOpex`, `milestone.updateDraft` |
| Permissions | `milestone.create/update` |
| Records | `project_milestones`, CAPEX event rows or `milestone_installments`, alert settings |
| Validation | Active project, dates/frequency, positive amounts, exact schedule sum, no overlap/duplicate sequence |
| Journal | None |
| Audit | `milestone.created`, `milestone.schedule_generated` |
| Acceptance | ₹2,00,00,000/36 schedule sums exactly; duplicate submission is idempotent; invalid period is rejected |

### 11.3 `04-finance-income/project-payment-alert.html`

Disposition: `MINOR_CHANGE`

- Retain alert list, Snooze and invoice action.
- Rename **Upload Invoice** to **Raise Invoice**.
- CAPEX alerts originate from due/achieved billing events.
- OPEX alerts originate from one scheduled installment.
- Snooze changes reminder timing, not installment/invoice dates.
- Only finalized invoice closes the alert, and only once the event or installment is fully invoiced; billed in part, the alert stays open showing what is left to invoice (ADR-156). A draft displays `INVOICE_DRAFT`.

Contract: `paymentAlert.list`, `paymentAlert.snooze`, `invoice.createDraftFromAlert`; permissions `payment_alert.read/snooze`, `invoice.create`; no journal; audit `payment_alert.snoozed` and invoice events.

### 11.4 `04-finance-income/project-invoice-add.html`

Disposition: `MINOR_CHANGE`

Keep the visible form structure, Draft and Raise Invoice actions. Apply:

- milestone/installment is preselected from alert where applicable;
- several open CAPEX events on the same project may share one invoice; an OPEX installment stays on its own invoice (ADR-126);
- the form chooses a regular tax invoice or a proforma; only the tax invoice posts the receivable and GST (ADR-128);
- converting an issued proforma opens a separate tax-invoice draft that can be changed before it is posted; the proforma stays (ADR-147);
- invoice number is server-generated/read-only at finalization;
- legal entity/GST registration derives from the project and is restricted;
- when the legal entity has more than one active bank account, the form requires a choice; one account is used without a question (ADR-142);
- OPEX displays service period;
- add due date/payment terms;
- invoice lines preserve HSN/SAC, seller/buyer and GST snapshots;
- CGST+SGST and IGST are mutually exclusive;
- primary tax invoice PDF is generated by CRM; inward acknowledgment remains uploadable;
- remove free ad-hoc invoice creation; use an approved additional-work milestone.

| Item | Definition |
|---|---|
| Queries | `invoice.getDraftDefaults`, `invoice.get`, `invoice.previewPdf` |
| Commands | `invoice.createDraft`, `invoice.updateDraft`, `invoice.startConversion`, `invoice.finalize`, `invoice.void` |
| Permissions | `invoice.read/create/update/finalize/void` |
| Records | Invoice header, lines, tax summary, snapshots, documents, alert/installment link |
| Journal | Draft: none. Finalize: Dr Accounts Receivable; Cr Revenue and Output GST |
| Audit | `invoice.draft_created`, `invoice.updated`, `invoice.finalized`, `invoice.voided` |
| Acceptance | Number uniqueness under concurrency, tax exclusivity, immutable finalized values, period lock and idempotency |

### 11.5 Invoice list screens

| HTML file | Disposition | Contract |
|---|---|---|
| `04-finance-income/project-invoices.html` | `MINOR_CHANGE` | `invoice.list` scoped to project; permissions `invoice.read/export/create`. Show document status and settlement status separately. Columns must separately expose invoice total, cash received, TDS/GST-TDS settled, recoverable deductions, accepted/disputed penalties and true outstanding. Each figure stays on its own line, stacked in a "Received & Deductions" cell, so the table fits without horizontal scrolling. |
| `04-finance-income/invoices-all.html` | `MINOR_CHANGE` | Same authoritative invoice read model across projects. Preserve filters/export; add legal entity and settlement filters when needed. No screen-local “Received” calculation. |

### 11.6 `04-finance-income/project-payment-add.html`

Disposition: `FUNCTIONAL_CHANGE`

The page may remain visually recognizable, but it is a client receipt form internally.

Keep:

- Invoice Payment/Hold Release switch;
- invoice selection;
- deduction and penalty sections;
- receipt details, company/bank, UTR/reference and proof;
- live calculation panel.

Required corrections:

1. Invoice taxable amount, CGST, SGST, IGST and total are read-only.
2. Enter the amount applied to the invoice. It starts as the outstanding. TDS, GST-TDS and other deductions come out of that amount; the bank receives what is left. Cash plus deductions still equals the amount settled, and that total cannot exceed the outstanding. GST-TDS rates use the taxable base, the same base as TDS.
3. Allow partial receipt and multiple receipts per invoice.
4. Allow one receipt to allocate multiple invoices, one row by default.
5. Store TDS, CGST-TDS, SGST-TDS and IGST-TDS separately.
6. Store hold, retention, accepted penalty, disputed penalty and other deductions as typed lines.
7. Link each hold/retention release to its original deduction and allow partial releases.
8. All selected invoices and receiving bank account must belong to the same legal entity.
9. Backend returns the canonical settlement preview and posts it atomically.

| Item | Definition |
|---|---|
| Queries | `receipt.getAllocationCandidates`, `receipt.get`, `deduction.getOutstanding`, `receipt.calculatePreview` |
| Commands | `receipt.post`, `receipt.reverse`, `deduction.release`, `receipt.matchBankTransaction` |
| Permissions | `receipt.read/post/reverse`, `deduction.release`, `bank_reconciliation.match` |
| Records | Receipt, allocations, typed deductions/releases, documents, bank matching candidate |
| Journal | Dr Bank/cash and classified deduction accounts; Cr Accounts Receivable. Release: Dr Bank; Cr hold/retention receivable |
| Audit | `receipt.posted/reversed`, `receipt.allocated`, `deduction.recorded/released` |
| Acceptance | Multi-invoice and partial allocation, exact equation, no over-allocation/release, duplicate idempotency, concurrent outstanding lock |

Settlement invariant:

```text
cash allocated
+ TDS
+ CGST-TDS + SGST-TDS + IGST-TDS
+ hold + retention
+ accepted penalties
+ disputed deductions
+ other classified deductions
= invoice amount settled
```

### 11.7 Payment list screens

| HTML file | Disposition | Contract |
|---|---|---|
| `04-finance-income/project-payment.html` | `MINOR_CHANGE` | Project-scoped `receipt.list`; permissions `receipt.read/export/post`. Rename ambiguous values to Cash Received, Invoice Settled and Recoverable/Disputed deductions. Hold Release action opens the linked deduction flow. |
| `04-finance-income/payment-integration-all.html` | `MINOR_CHANGE` | Organization-wide Receipt/Payment Integration list backed by receipts and bank matches. Preserve filters; show type, allocation status and reconciliation status separately. |

## 12. Procurement, expenses and recurring spend

### 12.1 Purchase workflow

| HTML file | Disposition | Query/command and permission | Domain, journal and acceptance |
|---|---|---|---|
| `05-finance-expense/purchase-list.html` | `MINOR_CHANGE` | `purchaseRequest.list`; `purchase_request.read/export/create` | Show request, approval, receipt, vendor-bill and payment states separately rather than one ambiguous status. |
| `05-finance-expense/purchase-request.html` | `MINOR_CHANGE` | `purchaseRequest.createDraft/submit`; `purchase_request.create/submit` | Keep requirement, vendor, project, estimate, priority, GST expectation and quotation. Support request lines. Submission creates workflow only; no expense/journal. |
| `05-finance-expense/purchase-view.html` | `FUNCTIONAL_CHANGE` | `purchaseRequest.getDetail`, approve/reject and downstream actions; scoped permissions | Preserve detail/timeline layout. Add explicit approval, optional PO, goods/service receipt, vendor bill and payment-request sections. Creator cannot approve. Approval creates no accounting entry. |
| `05-finance-expense/purchase-payment.html` | `FUNCTIONAL_CHANGE` | `vendorPayment.getDefaults/post`; `vendor_payment.post` | It must record payment against an approved payment request and finalized vendor bill, not against the purchase request alone. Bill/tax values are read-only; payment date/account/UTR/proof and outward TDS are recorded. Journal: Dr Accounts Payable; Cr Bank and TDS Payable. |

Missing but required screens are listed in section 18: optional PO, goods/service receipt, vendor bill and payment request/approval. They may be drawers/steps inside Purchase View if this keeps the workflow simple.

### 12.2 Direct expense and employee advance

| HTML file | Disposition | Contract |
|---|---|---|
| `05-finance-expense/expense-add.html` | `FUNCTIONAL_CHANGE` | Preserve layout but explicitly choose Direct Company Expense or Employee Claim. Commands `directExpense.create/post` or `expenseClaim.create/submit`; permissions are separate. Posted direct expense creates Expense/Input GST debit and Bank/Cash/Card credit. A claim waits for approval/settlement. |
| `05-finance-expense/expense-employee.html` | `MINOR_CHANGE` | `expenseClaim.list`; permissions `expense_claim.read/approve/reimburse`, `employee_advance.read/create`. Preserve filters/actions; enforce maker-checker and state transitions. |
| `05-finance-expense/expense-employee-statement.html` | `MINOR_CHANGE` | `employeeExpense.getStatement`; show opening advance, advances, approved claims, reimbursements/recoveries and closing balance as separately named values. Export reconciles to advance control account. |
| `05-finance-expense/expense-give-advance.html` | `MINOR_CHANGE` | `employeeAdvance.issue`; permission `employee_advance.create`. Validate employee, legal entity, payment source and project. Journal: Dr Employee Advance Receivable; Cr Bank/Cash. Idempotency and period lock apply. |

### 12.3 Subscription and server screens

Use one recurring-cycle model. Upcoming cycles are forecasts/reminders and create no expense until linked to an actual posted expense/vendor bill.

| HTML file | Disposition | Contract |
|---|---|---|
| `05-finance-expense/subscriptions-all.html` | `ACCEPT` | `subscription.list`; `subscription.read/export/create`. Show status, frequency, next due, forecast and actual paid separately. |
| `05-finance-expense/subscription-add.html` | `MINOR_CHANGE` | Canonical create/edit form: `subscription.create/update`; generate cycle reminders using frequency. “Auto-generate” creates cycles only, no journal. |
| `05-finance-expense/subscription-view.html` | `MINOR_CHANGE` | Detail plus cycles. Record Payment must first create/link an actual expense/vendor bill and then payment; it cannot mark a forecast paid without accounting source. |
| `05-finance-expense/subscriptions-add.html` | `RETIRE` | Conflicting duplicate form. Merge any useful payment-method fields into cycle payment/expense recording, not subscription master creation. Redirect to canonical `subscription-add` route. |
| `05-finance-expense/subscriptions-dashboard.html` | `MINOR_CHANGE` | `subscription.getDashboard`; distinguish forecast recurring commitment from posted/paid spend. Cards reconcile to list filters. |
| `05-finance-expense/servers-all.html` | `ACCEPT` | `server.list`; retain dedicated operational view while using shared recurring-cycle infrastructure. |
| `05-finance-expense/servers-add.html` | `MINOR_CHANGE` | `server.create/update`; preserve provider, projects served, manager, region, amount/frequency/dates/status. Generated cycles are reminders only. |
| `05-finance-expense/server-view.html` | `MINOR_CHANGE` | `server.getDetail`; payment action links cycle to posted expense/vendor bill and payment. Preserve operational metadata and billing history. |

## 13. Employee and project salary costing

| HTML file | Disposition | Query/command and permission | Domain, audit and acceptance |
|---|---|---|---|
| `06-hr-payroll/employee-master.html` | `FUNCTIONAL_CHANGE` | `employee.list/create/update`; `employee.read/manage`. Excel import: `employee.downloadImportSample/previewImport/importRows` (`employee.manage`) | Employee is separate from User. Login email/user access is optional and managed through Users/RBAC. Monthly salary shown here is not historical authority; salary imports own monthly gross salary. Audit changes; no payroll processing. Implemented: the prototype's inline Login-email/Role fields and Export button are dropped in favor of a separate "Enable System Access" action reusing the Users backend, and every field change (including salary) is fully captured in the audit trail — see ADR-047. Excel import creates employees from the sample columns (code, name, department, designation, employment type, reimbursable, monthly salary, joining date, status). Department, designation and employment type match an existing master by name or code. A monthly salary opens the compensation history from the joining date. Any invalid row imports nothing. Login access is not imported — see ADR-124. |
| `06-hr-payroll/employee-salary-upload.html` | `MINOR_CHANGE` | `salaryImport.preview/commit`; `salary_import.create/commit`. Screen is the Salary tab of `/employee-costing` (ADR-125) | Import monthly gross salary only. Validate month uniqueness, duplicates, unmatched employees and totals; preview before atomic commit. Preserve source file/checksum and audit batch. |
| `06-hr-payroll/employee-effort-entry.html` | `MERGE` | Canonical monthly allocation entry: `employeeAllocation.getMonth/saveDraft/submit`; `employee_allocation.manage`. Screen is the Allocation tab of `/employee-costing` (ADR-125) | Merge effort and contribution into rows that allocate 100% across projects and non-project targets. Submission requires exactly 100%; deterministic salary rounding. |
| `06-hr-payroll/employee-contribution-entry.html` | `RETIRE` | Merge useful contribution notes/metrics into the canonical monthly allocation screen; no independent percentage truth. Redirect to allocation entry. |
| `06-hr-payroll/employee-effort-summary.html` | `MINOR_CHANGE` | `employeeAllocation.getSummary`; `employee_allocation.read/export` | Rename to Allocation Summary. Values derive from submitted/locked allocations. |
| `06-hr-payroll/contribution-dashboard.html` | `MERGE` | Present as Allocation/Contribution Dashboard using the same allocation records; no second data-entry workflow. |
| `06-hr-payroll/employee-manpower-cost.html` | `MINOR_CHANGE` | `projectCost.getManpower`; `project_cost.read/export` | Formula is imported gross salary × allocation percentage. Totals reconcile to salary import and allocation records. |

## 14. Inventory screens

| HTML file | Disposition | Query/command and permission | Domain, journal and acceptance |
|---|---|---|---|
| `07-assets-inventory/inventory-list.html` | `MINOR_CHANGE` | `inventory.list`; `inventory.read/export`, actions by permission | One central inventory location. Show on-hand quantity, weighted-average value and reserved/available if introduced. |
| `07-assets-inventory/inventory-detail.html` | `MINOR_CHANGE` | `inventory.getItemLedger`; `inventory.read/export` | Movement ledger is authoritative. Filters do not independently recompute opening/closing values. |
| `07-assets-inventory/inventory-add-stock.html` | `FUNCTIONAL_CHANGE` | `inventoryReceipt.record`; `inventory.receive` | Preserve vendor, purchase link, date, invoice/challan and attachment. Link each stock line to approved purchase/vendor-bill line when applicable. Prevent duplicate receipt and excess quantity unless approved. Do not duplicate the vendor-bill liability journal. |
| `07-assets-inventory/inventory-add-consumption.html` | `MINOR_CHANGE` | `inventoryConsumption.post`; `inventory.consume` | Add item/quantity rows if not already explicit. Validate available stock and active project. Journal: Dr Project Material Cost; Cr Inventory using weighted average. |

No Fixed Asset or depreciation screens are required.

## 15. Introducer fee screens

| HTML file | Disposition | Contract |
|---|---|---|
| `09-introducer-fee/introducer-all.html` | `MINOR_CHANGE` | `introducerAgreement.listBalances`; `introducer_fee.read/export/create/pay`. Separately show accrued, paid, TDS, advance/unallocated and payable balances. |
| `09-introducer-fee/introducer-fee-add.html` | `MINOR_CHANGE` | `introducerAgreement.create`, `introducerAccrual.post`; preserve project/date/remarks and multiple introducers. Define basis/rate/amount explicitly. Accrual journal: Dr Commission Expense; Cr Introducer Payable. |
| `09-introducer-fee/introducer-fee-payment.html` | `FUNCTIONAL_CHANGE` | `introducerPayment.post`; select payment source by mode, record TDS and allocate one/more accruals. Excess becomes unallocated introducer advance, not negative payable. Journal follows payable settlement/advance rules. |

## 16. Report screen contracts

### Global report rules

- Reports are read-only projections from authoritative records and posted journals.
- Every financial report shows legal entity, period/as-of date, currency and accounting basis.
- Filters and exported output must use the same backend query.
- Drill-down must reach source documents and journal entries.
- No report maintains its own alternative formula.
- Report access/export is permission controlled and sensitive exports are audited.
- Empty, late-posting, locked-period and unreconciled-data warnings are visible.

| HTML file(s) | Disposition | Authoritative contract |
|---|---|---|
| `10-reports/reports-all.html` | `MINOR_CHANGE` | `report.getCatalog`; show only authorized reports. “Scheduled reports” is deferred unless notification scheduling is implemented. |
| `10-reports/report-business-overview.html` | `FUNCTIONAL_CHANGE` | Explicitly label each card as accrual, cash, contract/budget or bank basis. Do not present a blended “profit.” |
| `10-reports/report-project-pl.html` | `MINOR_CHANGE` | Accrual Project P&L from posted revenue/cost journal dimensions; `report.projectPL`. |
| `10-reports/report-earning.html` | `FUNCTIONAL_CHANGE` | Rename/define as Cash Profitability or Contribution report. State formula and do not equate it with accrual P&L. |
| `10-reports/report-cost-to-company.html` | `MINOR_CHANGE` | Project cost from posted/direct cost and analytical salary/inventory/introducer dimensions. Summary must equal detail table. |
| `10-reports/report-cash-flow.html` | `MINOR_CHANGE` | Bank/cash transactions and matched postings by period/account; opening + movement = closing. |
| `10-reports/report-aging.html` | `MINOR_CHANGE` | Receivable aging by invoice due date plus separate hold/retention aging. As-of computation is backend-owned. |
| `10-reports/report-outstanding-summary.html` | `MINOR_CHANGE` | Separate invoice outstanding, TDS/GST-TDS pending reconciliation, hold/retention recoverable and disputed deductions. |
| `10-reports/report-pending-invoice.html` | `MINOR_CHANGE` | Finalized invoice outstanding only; alert/draft invoice backlog appears as a separate billing-pending measure. |
| `10-reports/report-payment.html` | `MINOR_CHANGE` | Client receipt report: actual cash received, invoice settled, deductions and unallocated cash are separate. |
| `10-reports/report-payment-hold.html` | `MINOR_CHANGE` | Hold/retention deduction and release ledger with original deduction link and outstanding balance. |
| `10-reports/report-penalty.html` | `MINOR_CHANGE` | Typed penalties with accepted/disputed/resolution state and accounting treatment. |
| `10-reports/report-gst-output.html` | `MINOR_CHANGE` | Finalized sales invoices and credit/debit notes by GST registration/tax period. Reconcile to output GST ledgers. |
| `10-reports/report-gst-input.html` | `MINOR_CHANGE` | Finalized vendor bills/eligible ITC by GST registration and tax period. Separate eligible/ineligible/pending. |
| `10-reports/report-gst-net.html` | `FUNCTIONAL_CHANGE` | Net liability = authoritative Output GST − eligible Input GST ± adjustments. Component totals must equal displayed net and ledger balances. |
| `10-reports/report-gstr-register.html` | `MINOR_CHANGE` | GST document register from invoice/vendor-bill tax lines and notes; it is not a GST return-filing engine unless separately scoped. |
| `10-reports/report-tds-inward.html` | `MINOR_CHANGE` | Client TDS/GST-TDS deductions, certificate status and receivable reconciliation. |
| `10-reports/report-tds-outward.html` | `MINOR_CHANGE` | Vendor/introducer TDS payable, deposited and certificate/challan status. |
| `10-reports/report-tds-recon.html` | `FUNCTIONAL_CHANGE` | Build a complete reconciliation screen; prototype is visually incomplete. Match internal deductions to certificate/26AS records with exceptions and audit. |
| `10-reports/report-expense.html` | `MINOR_CHANGE` | Posted direct expenses, vendor-bill expense lines and approved claims; explicitly exclude unposted requests/forecasts unless filter says Forecast. |
| `10-reports/report-vendor-payment.html` | `MINOR_CHANGE` | Vendor payments and allocations/TDS; reconcile to payable settlement and bank transactions. |
| `10-reports/report-reimbursement.html` | `MINOR_CHANGE` | Employee claims, approvals, advance adjustments, reimbursements and recoveries. |
| `10-reports/report-employee-wallet.html` | `FUNCTIONAL_CHANGE` | Rename Employee Advance Report; there is no wallet product. Reconcile opening + advances − approved adjustments ± settlements = closing. |
| `10-reports/report-recurring-spend.html` | `MINOR_CHANGE` | Show Forecast Cycles and Actual Posted Spend as separate columns/filters. |
| `10-reports/report-manpower-utilization.html` | `MINOR_CHANGE` | Submitted/locked monthly allocation percentages and salary cost; no independent contribution dataset. |
| `10-reports/report-emd-recovery.html` | `MINOR_CHANGE` | Instrument lifecycle, lodged/returned/forfeited/outstanding and due dates; distinguish cash from BG exposure. |
| `10-reports/report-introducer-statement.html` | `MINOR_CHANGE` | Accrual, TDS, payment allocation, unallocated advance and balance by introducer/project. |

## 17. Screens that may retain the visual design but not the original calculation

The following prototype values are known examples of why the backend must own formulas:

```text
Invoice ₹37,76,000
− TDS ₹3,20,000
− GST-TDS ₹64,000
− Penalty ₹2,00,000
− Hold ₹4,00,000
= Actual bank receipt ₹27,92,000
```

```text
Initial receipt ₹1,52,60,000
+ Hold release ₹4,00,000
+ Hold release ₹3,00,000
= Cumulative cash received ₹1,59,60,000
```

```text
OPEX total ₹2,00,00,000 / 36
Installments 1–35: ₹5,55,556
Final installment: ₹5,55,540
Exact total: ₹2,00,00,000
```

The live UI preview may call the backend calculator. The final command recalculates and persists the result in the same transaction.

## 18. New required screens without usable HTML

These are necessary for confirmed requirements. Design them with the same shell, typography, card, form and table language as the prototype.

| Screen | Disposition | Minimum contract |
|---|---|---|
| Legal Entities and GST Registrations | `NEW_REQUIRED` | Simple list/detail forms; initially one Zitaware Solutions entity/registration, added by an administrator (not seeded, ADR-191); future 3–4 entities/multiple registrations. |
| Users, Roles and Permissions | `NEW_REQUIRED` | Invite/disable user, role grants, per-user overrides, project scope and session revoke. Employee link optional. Roles are admin-manageable (custom create/edit/delete + permission matrix); the three seeded `isSystem` roles (Admin/Accountant/Project Manager) are locked baselines — see ADR-045. User detail composes roles/overrides/effective-permissions/employee link in one view; enable/disable/revoke-sessions and employee link/unlink are separate admin actions — see ADR-046. |
| Tender list/add/detail/documents | `FUNCTIONAL_CHANGE` | The tender is part of the lead (ADR-131). Tender number, tender date and submission deadline are fields on the lead. Marking the lead Won creates the project. The separate Tenders menu is hidden. |
| Approval Queue | `NEW_REQUIRED` | Purchase/payment requests assigned to Accountant or Project Manager; creator cannot approve; reason required for rejection. |
| Optional Purchase Order | `NEW_REQUIRED` | May be a Purchase View step/drawer; issue only when needed. No accounting entry. |
| Goods/Service Receipt | `NEW_REQUIRED` | Record quantities/services received against approved request/optional PO. Link to stock receipt where applicable. |
| Vendor Bill | `NEW_REQUIRED` | Draft/finalize supplier invoice with lines, GST, ITC and payable posting. |
| Payment Request | `NEW_REQUIRED` | Request/approve payment against finalized vendor bills before payment posting. |
| Credit Note and Debit Note | `NEW_REQUIRED` | Draft/finalize against invoice with tax-period-aware posting and immutable references. |
| Bank Transaction Import and Reconciliation | `NEW_REQUIRED` | Import/manual statement lines, match/unmatch receipts/payments, exception handling and period lock. |
| TDS Certificate/26AS Reconciliation | `NEW_REQUIRED` | Import/record certificates and match internal deductions; partial/unmatched exception queue. |
| Chart of Accounts and Ledger Viewer | `NEW_REQUIRED` | Accountant-managed accounts and read-only journals/source drill-down. |
| Financial Years and Accounting Periods | `NEW_REQUIRED` | Open/soft-close/lock/reopen with permission, reason and audit. Implemented: scoped to a Legal Entity picker; `setCurrentFinancialYear` added so "current" can be changed after creation, not just at create time; every transition collects a mandatory reason via a modal — see ADR-050. |
| Audit Log | `NEW_REQUIRED` | Search actor/entity/action/time; permission-scoped before/after/domain payload. Implemented: server-side paginated/filtered (first departure from this app's client-side-fetch convention, given unbounded event volume); actor filter is free-text on the actor_email snapshot; entityType/action filter options are dynamic, not hardcoded — see ADR-051, which also fixes a systemic actor_email-population gap found while verifying this screen. |

## 19. Route-level acceptance checklist

A screen is not complete until:

- its route, query, commands and permission keys are documented;
- all visible prototype fields are implemented, explicitly changed or explicitly rejected;
- loading, empty, error, forbidden and version-conflict states exist;
- responsive behavior is verified at agreed desktop/tablet/mobile sizes;
- keyboard navigation, labels and error announcements pass accessibility checks;
- backend validation and permissions are integration-tested;
- financial calculations use canonical server results;
- domain write, journal, audit and outbox records are atomic where required;
- exports match on-screen filters and authoritative totals;
- the relevant HTML screenshot comparison is reviewed;
- this file and `13-progress.md` are updated with implementation status.

## 20. Development use

Before starting a module:

1. Copy its row/section into the implementation issue.
2. Add final Next.js route and read-model fields.
3. Add exact Zod input/output and stable error codes.
4. Add domain and database invariants.
5. Add journal/posting rule reference where applicable.
6. List unit, integration and end-to-end tests.
7. Implement shared components before page-specific components.
8. Mark deviations from the HTML with reason and approval.

No module is complete merely because its page resembles the prototype. It is complete when the visible workflow, permissions, domain records, accounting, audit trail and reconciliation all satisfy this contract.
