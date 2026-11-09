# Claude Development Instructions

Read `README.md` and all relevant files under `docs/` before planning or changing code.

## Working rules

- Implement one roadmap phase and one bounded vertical slice at a time.
- Never generate the full Prisma schema in one pass.
- Before adding a model, identify its aggregate, owner module, state machine, permissions, audit events, accounting effect, and required indexes.
- Treat the HTML screens as UI contracts. Preserve their layout and fields unless `docs/04-screen-contracts.md` records a required correction.
- Use `docs/16-html-module-reference.md` to select the exact target, shared-shell, related-workflow and screenshot references for each module task. Do not load all prototype files for every task.
- Follow `docs/15-ui-design-system.md` for all shared colors, typography, spacing, grids, buttons, forms, tables, states, responsive behavior and Ant Design/Tailwind implementation.
- Compare each completed screen with its paired `1440 × 900` HTML screenshot. Do not introduce a generic Ant Design appearance.
- Do not invent new business states or accounting treatments. Record unresolved decisions in `docs/12-decisions-log.md`.
- Update `docs/13-progress.md` in the same change as completed implementation work.
- Add or update tests with every business rule.
- Run development directly through the root `npm run dev` command.
- Build production artifacts and manage long-running processes through PM2 and `ecosystem.config.cjs`.
- Do not add Docker, Docker Compose, Caddy or Pino.

## Architecture constraints

- TypeScript strict mode.
- Modular monolith with clear module boundaries.
- Next.js App Router frontend.
- NestJS backend with tRPC.
- PostgreSQL with Prisma.
- All money uses PostgreSQL `numeric` and Decimal.js; never JavaScript floating-point arithmetic.
- Business dates use PostgreSQL `date`; event timestamps use UTC `timestamptz`.
- Application-generated UUID v7 identifiers.
- Organization scope is explicit through `organization_id`.
- Legal entity and GST registration are explicit on posted taxable documents.
- npm workspaces are the package-management baseline.
- Application logs use the internal console-based structured logger and are captured from stdout/stderr by PM2.

## Financial constraints

- Every posting uses a single database transaction.
- Every posting has a unique idempotency key.
- Posted invoices, receipts, vendor bills, payments, journals, and reconciliations are not edited or deleted.
- Drafts may be edited; finalized documents require correction workflows.
- Debit total must equal credit total before a journal entry is committed.
- Invoice amounts are never re-entered or edited from the receipt screen.
- A receipt may allocate to multiple invoices; an invoice may receive multiple receipts.
- TDS, GST-TDS, hold, retention, penalties, and other deductions are separate typed records.
- CGST+SGST and IGST are mutually exclusive for one taxable supply.
- Do not calculate accounting totals independently in React components.

## Change checklist

Before marking a task complete:

1. Validate authorization and maker-checker rules.
2. Validate state transition and concurrency behavior.
3. Validate monetary and tax invariants.
4. Validate audit event and outbox event creation.
5. Run unit, integration, and affected end-to-end tests.
6. Confirm migration rollback/forward safety.
7. Update documentation and progress.
8. Confirm no Docker, Caddy or Pino requirement was introduced.
9. Confirm the affected UI follows `15-ui-design-system.md` and its paired HTML screenshot.
10. Confirm the task declares and studies the reference bundle required by `16-html-module-reference.md`.
