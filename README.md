# Zitaware CRM Development Pack

This directory is the implementation source of truth for the Zitaware Solutions CRM.

The existing static HTML screens remain the primary UI and field-reference baseline. The backend and database must not copy the HTML page structure one-to-one. One submitted screen may create several domain, accounting, audit, document, and notification records in one transaction.

## Documentation order

1. `docs/00-product-scope.md`
2. `docs/01-business-decisions.md`
3. `docs/02-system-architecture.md`
4. `docs/03-domain-model.md`
5. `docs/04-screen-contracts.md`
6. `docs/05-workflows-state-machines.md`
7. `docs/06-accounting-posting-rules.md`
8. `docs/07-database-conventions.md`
9. `docs/08-api-contracts.md`
10. `docs/09-security-audit.md`
11. `docs/10-testing-strategy.md`
12. `docs/11-development-roadmap.md`
13. `docs/12-decisions-log.md`
14. `docs/13-progress.md`
15. `docs/14-runtime-deployment.md`
16. `docs/15-ui-design-system.md`
17. `docs/16-html-module-reference.md`

## Precedence

When sources conflict, use this order:

1. Confirmed rules in `01-business-decisions.md`
2. Canonical workflows and accounting rules in this pack
3. `04-screen-contracts.md` for required screen corrections
4. `16-html-module-reference.md` for selecting the exact module/workflow HTML
   reference bundle
5. `15-ui-design-system.md` for shared visual and component rules
6. Current HTML screens and screenshots for page-specific layout, usability,
   labels and intended fields
7. The earlier monolithic `ARCHITECTURE.md`

The earlier architecture document contains superseded decisions and must not be used alone for implementation.

## Non-negotiable financial rules

- Proper double-entry and accrual-based accounting.
- Explicit CGST, SGST, IGST, TDS, GST-TDS, hold, retention, penalty, debit, and credit classification.
- Posted financial records are immutable; corrections use reversal, credit note, debit note, void, or replacement workflows.
- Financial calculations run on the backend with decimal arithmetic.
- Every posted journal entry must balance.
- Every financial write is idempotent and auditable.
- Reports derive from posted source documents and the general ledger, not duplicated UI formulas.

## First implementation slice

The first finance vertical slice is:

`Project → CAPEX/OPEX milestone → schedule/payment alert → invoice → client receipt → allocations/deductions → journal → bank reconciliation`

CAPEX is event-based. OPEX is duration-based and generates schedule rows, not invoices. Each due OPEX period is invoiced separately.

## Runtime baseline

- Development runs directly with `npm run dev`.
- Production uses compiled builds managed by PM2 through `ecosystem.config.cjs`.
- npm workspaces are used for the monorepo.
- Docker, Docker Compose and Caddy are not used.
- Pino is not required; an internal console-based logger writes to stdout/stderr for PM2 capture.

See `docs/14-runtime-deployment.md` for commands and production checks.
