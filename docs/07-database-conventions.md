# Database Conventions

## PostgreSQL

- PostgreSQL is authoritative.
- Prisma models the common schema.
- Raw SQL migrations are allowed and required for constraints, partial indexes, triggers, and advanced PostgreSQL features Prisma cannot express.
- Every migration is reviewed and tested against an empty database and an upgraded database.

## Naming

| Item | Convention | Example |
|---|---|---|
| Table | plural `snake_case` | `client_receipts` |
| Column | `snake_case` | `actual_received_amount` |
| Foreign key | singular target + `_id` | `invoice_id` |
| Timestamp | suffix `_at` | `finalized_at` |
| Business date | suffix `_date` | `invoice_date` |
| Amount | suffix `_amount` | `taxable_amount` |
| Percentage/rate | suffix `_rate` or `_pct` | `tds_rate` |
| Status | `UPPER_SNAKE_CASE` values | `PARTIALLY_SETTLED` |
| Unique constraint | `uq_{table}_{columns}` | `uq_invoices_number_scope` |
| Index | `idx_{table}_{columns}` | `idx_invoices_project_status` |
| Check | `chk_{table}_{rule}` | `chk_journal_line_one_side` |

## Common columns

Mutable business tables normally contain:

- `id uuid`
- `organization_id uuid`
- `created_at timestamptz`
- `created_by uuid`
- `updated_at timestamptz`
- `updated_by uuid`
- `version integer`

Reference/master tables may also contain:

- `is_active boolean`
- `deleted_at timestamptz`
- `deleted_by uuid`

Do not place `deleted_at` on immutable posted journal lines as a normal deletion mechanism.

## Identifiers

- Use application-generated UUID v7.
- Public document numbers are separate from primary keys.
- Never derive security from UUID unpredictability.

## Money

- Store monetary values as `numeric(19,4)` for internal precision.
- Enforce document currency, initially `INR`.
- Round GST and payable totals according to one documented money policy.
- Use Decimal.js in the application.
- Never use `float`, `double precision`, or JavaScript `number` for financial calculations.
- Store final document values; do not repeatedly recalculate historical tax using current rules.

## Dates and time

- Event time: `timestamptz`, UTC.
- Business calendar date: PostgreSQL `date`.
- Display: `Asia/Kolkata`.
- Never convert a `date` field through a timezone.

## Tax

Taxable lines store:

- taxable amount
- CGST rate and amount
- SGST rate and amount
- IGST rate and amount
- cess where future-required
- line total
- HSN/SAC
- supply type

Checks:

- Intrastate: IGST equals zero.
- Interstate: CGST and SGST equal zero.
- Header totals equal line summaries.

GST-TDS uses separate CGST-TDS, SGST-TDS, and IGST-TDS fields/records.

## Snapshots

Finalized documents preserve relevant historical values:

- seller and buyer identity/address/GSTIN
- bank account display/reference where required
- tax rates and amounts
- HSN/SAC
- project/milestone description
- payment terms
- party PAN

JSON may support display snapshots, but every value needed for reporting, filtering, reconciliation, or accounting must also have structured columns/relations.

## Status

- Use explicit state-machine values.
- Do not infer a posted source document’s lifecycle only from null timestamps.
- Derived status should be calculated or refreshed from authoritative rows and must not become an independently editable truth.

## Deletion and correction

| Record type | Rule |
|---|---|
| Draft | May be edited and abandoned |
| Master/reference | May be deactivated/soft-deleted if unreferenced policy permits |
| Finalized financial document | No delete/edit; use correction document |
| Journal | No delete/edit; reverse |
| Audit event | Append-only |
| Reconciliation sign-off | Immutable; controlled reopen event |

## Concurrency

- Add `version` for optimistic concurrency on user-edited aggregates.
- Lock rows when allocating invoice/hold outstanding balances.
- Allocate document numbers in the finalization transaction.
- Use unique constraints as the last concurrency guard.

## Idempotency

Financial commands accept an idempotency key. Store:

- organization
- command type
- idempotency key
- request hash
- source record
- result reference

Same key + different request hash is rejected.

## Indexing baseline

- All foreign keys.
- Active status/date filters.
- Financial document number scope.
- Project and party dimensions.
- Unmatched bank transactions.
- Open alerts and due dates.
- Outstanding receivables/payables.
- Partial indexes for active/non-deleted masters and open workflow items.

## Database-enforced invariants

- Journal balance.
- One-sided journal lines.
- Non-negative financial components.
- Unique invoice numbering scope.
- OPEX installment sequence uniqueness.
- Allocation cannot be negative.
- Deduction release cannot exceed outstanding.
- Employee monthly submitted allocation equals 100%.
- Maker and checker differ.

Some aggregate constraints require a transactional stored function or deferred trigger rather than a simple check constraint.

## Organization-consistency composite foreign keys

Wherever a child table and its parent table are both organization-scoped
(both carry `organization_id`), the child's foreign key to the parent must
be a composite `(parent_id, organization_id) REFERENCES parent(id,
organization_id)`, not a plain `parent_id -> parent.id` FK. A plain FK only
proves the parent row exists somewhere — it does not prove the parent
belongs to the same organization as the child, which would let a record
from Organization A reference a parent from Organization B.

Composite unique constraints and composite foreign keys (e.g. `@@unique([id,
organizationId])` plus `@relation(fields: [childId, organizationId],
references: [id, organizationId])`) **are** expressible natively in Prisma's
schema DSL — this is not a raw-SQL-only technique. Only *functional*
(`lower(trim(...))`) and *partial* (`WHERE`) indexes genuinely require hand-
written migration SQL. Model every new organization-consistency FK natively
in `schema.prisma`, not as a hand-added migration-SQL constraint — the
native form is fully known to Prisma's diff engine and does not trigger the
"propose to drop the hand-added constraint" problem that affects the
(currently not-yet-converted) `districts`/`cities` composite FK from
sub-phase 2.3.

When the parent side is nullable on the child (e.g. `Employee.userId`,
`Document.documentCategoryId`), the composite FK is trivially satisfied
when the nullable column is `NULL` — Postgres skips a composite FK check
entirely when any column in the tuple is `NULL` (`MATCH SIMPLE`, the
default). No parent lookup and no organization check happens for an
unset optional reference.

## Migration development procedure

`schema.prisma`'s `datasource db` block declares `shadowDatabaseUrl =
env("SHADOW_DATABASE_URL")`, pointing at a genuinely separate, disposable
database (`zitaware_crm_shadow` in local dev) that Prisma uses as scratch space for
`migrate dev` and `migrate diff`. This exists because of a real incident:
running `prisma migrate diff --shadow-database-url <url>` with the URL
manually (and mistakenly) set to the real local dev database caused Prisma
to use that database as throwaway scratch space, wiping its seeded/test
data and its `_prisma_migrations` tracking table (table structures were
unaffected; recovered via `prisma migrate resolve --applied` for every
prior migration plus re-running the idempotent seed script).

Rules going forward:

- **Never type `--shadow-database-url` by hand on the command line.**
  `migrate dev` reads `shadowDatabaseUrl` from `schema.prisma` automatically.
  `migrate diff --from-migrations` is the one Prisma subcommand that still
  requires the flag explicitly (it does not consult `schema.prisma`'s
  `shadowDatabaseUrl` for this diff direction) — `npm run
  prisma:migrate:diff` supplies it FOR you, sourced from the already-
  verified-safe `$SHADOW_DATABASE_URL` environment variable, so a human
  never has the chance to type the wrong value in.
- Use `npm run prisma:migrate:dev` (from `packages/database`) for normal
  migration authoring — this runs `scripts/assert-shadow-database-safe.mjs`
  first, which refuses to proceed if `SHADOW_DATABASE_URL` is unset or
  identical to `DATABASE_URL`.
- To generate diff SQL for the hand-edit workflow this project uses (CHECK
  constraints, composite FKs pre-ADR-039, functional/partial indexes still
  needed for districts/cities and normalized-name uniqueness), use `npm run
  prisma:migrate:diff` — it runs the same safety check first, then invokes
  `prisma migrate diff --from-migrations ./prisma/migrations
  --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url
  "$SHADOW_DATABASE_URL" --script`.
- `prisma migrate deploy`, `prisma generate`, and `prisma migrate status` do
  not need shadow-database scratch space and work normally even if
  `SHADOW_DATABASE_URL` is unset (verified — this is why CI, which only
  runs `migrate deploy`, needs no changes for this).

