# System Architecture

## Style

Use a modular monolith. It provides strong transaction boundaries and simpler deployment for a solo developer while keeping business domains independently maintainable.

## Implementation baseline

| Layer | Choice |
|---|---|
| Language | TypeScript, strict mode |
| Runtime | Node.js 24 LTS |
| Package manager | npm with npm workspaces |
| Monorepo task runner | Turborepo, invoked through root npm scripts |
| Frontend | Next.js App Router |
| UI component library | Ant Design (AntD) |
| Client state management | Redux Toolkit with React-Redux typed hooks |
| Server state and API cache | tRPC query integration; do not duplicate server records in Redux |
| CSS and layout utilities | Tailwind CSS |
| Backend | NestJS |
| API | tRPC |
| Database | PostgreSQL |
| ORM | Prisma |
| Validation | Zod |
| Financial math | Decimal.js |
| Jobs | pg-boss |
| Internal events | Transactional outbox plus in-process handlers |
| Files | S3-compatible object storage |
| Email | Gmail SMTP (nodemailer, ADR-190) |
| Logging | Internal console-based structured logger; PM2 captures stdout/stderr |
| Development runtime | Direct host execution through `npm run dev` |
| Production process manager | PM2 using `ecosystem.config.cjs` |

Exact framework versions are pinned during repository bootstrap and upgraded deliberately through tested changes.

Docker, Docker Compose and Caddy are intentionally outside the project architecture. Do not add them to local setup, production deployment, CI, documentation or package requirements unless this decision is explicitly changed later.

Pino is also intentionally excluded. Do not add Pino or replace it with another logging dependency without a recorded architecture decision.

## Frontend architecture

The existing HTML files remain the visual and workflow baseline. Rebuild them as a shared React application rather than copying page-level HTML and CSS.

`15-ui-design-system.md` is the mandatory implementation standard for the
HTML-derived theme, shell, typography, spacing, grids, buttons, cards, forms,
tables, responsive behavior and visual acceptance.

### Responsibility split

| Concern | Required owner |
|---|---|
| Forms, tables, drawers, modals, date pickers, selects, notifications, pagination | Ant Design |
| Page layout, spacing, responsive grids, visibility utilities, small visual adjustments | Tailwind CSS |
| Authentication/session presentation, navigation state, user preferences, cross-screen draft/workflow state | Redux Toolkit |
| API data, loading, refetching, invalidation, pagination results | tRPC query cache |
| Financial totals, GST, schedules, outstanding balances and posting previews | Backend domain services |
| Form input/output validation | Shared Zod contracts |

### Ant Design and Tailwind rules

- Ant Design is the primary component library. Do not recreate its standard controls using custom Tailwind components.
- Tailwind is used for layout and utilities around Ant Design components, not for maintaining a second competing component system.
- Centralize Ant Design theme tokens and Tailwind design tokens so colors, typography, spacing and breakpoints stay aligned.
- Wrap Ant Design components in `packages/ui` only when the wrapper enforces a real shared requirement such as permission checks, money input, server errors or document upload.
- Do not use arbitrary CSS overrides against generated Ant Design internals. Prefer component props, theme tokens and stable wrapper classes.
- Configure the Next.js App Router integration for server rendering so Ant Design styles do not flash or mismatch during hydration.
- Preserve the prototype's information hierarchy and general appearance; minor adjustments are allowed for responsiveness, accessibility and correct financial behavior.

### Redux Toolkit rules

- Configure one typed store and typed hooks in the web application.
- Organize slices by cross-screen concern, not by HTML filename.
- Keep persisted business records in the server/database; Redux is not a second source of truth.
- Do not copy tRPC query results into Redux merely to make them global.
- Store only justified client state, such as authenticated-user presentation, selected organization/legal entity, navigation state, saved filters and multi-step draft state.
- Reset organization- or user-scoped slices on logout or scope change.
- Enable Redux DevTools only according to the environment/security policy and never expose secrets or full bank details in state.

### Recommended frontend structure

```text
apps/web/src/
├── app/                     # Next.js routes and layouts
├── features/                # Domain-focused UI: projects, invoices, receipts...
├── store/                   # Redux Toolkit store and cross-screen slices
├── server/                  # tRPC server/client integration
└── styles/                  # Tailwind entry point and minimal global CSS

packages/ui/
├── components/              # Approved shared AntD-based components
├── forms/                   # Money, GST, bank, document and date controls
├── tables/                  # Shared filters, exports and pagination
└── theme/                   # AntD theme plus shared design tokens
```

## Proposed monorepo

```text
zitaware-crm/
├── CLAUDE.md
├── README.md
├── ecosystem.config.cjs
├── package.json
├── package-lock.json
├── docs/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── database/
│   ├── contracts/
│   ├── accounting/
│   ├── ui/
│   ├── config/
│   └── testing/
└── scripts/
```

## Runtime and deployment model

### Development

Development runs directly on the developer machine:

```bash
npm install
npm run dev
```

The root `dev` script starts the web, API and worker applications in watch mode through the monorepo task runner. PostgreSQL and any required external services are configured through validated environment variables; the repository must not require containers.

Required root scripts:

```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "start": "turbo run start",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  }
}
```

### Production

Production runs compiled applications directly under PM2:

```bash
npm ci
npm run build
npx prisma migrate deploy
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Routine release restart:

```bash
npm ci
npm run build
npx prisma migrate deploy
pm2 reload ecosystem.config.cjs --env production
```

PM2 manages the long-running processes only. TLS termination, domain routing and any upstream reverse proxy are server/environment responsibilities and are not implemented with Caddy in this project.

The ecosystem file must define separate processes for:

- Next.js web application;
- NestJS API;
- background worker.

Each process must have an explicit working directory, start command, environment, restart policy, memory limit, timestamped logs and graceful shutdown timeout. Secrets must come from the server environment or a protected environment file and must not be committed.

Full operational commands and release checks are defined in `14-runtime-deployment.md`.

## Logging model

Application code uses one internal logger wrapper built on the Node.js console API.

- Emit structured objects with timestamp, level, service, environment, correlation ID, event name and safe context.
- Send informational events to stdout and errors to stderr so PM2 separates and retains them.
- Never log passwords, tokens, cookies, authorization headers, full bank details, uploaded document contents or unredacted personal data.
- Centralize redaction and serialization in the logger wrapper; domain code must not scatter raw `console.log` calls.
- PM2 log files must be covered by host-level `logrotate` and disk-usage monitoring.
- Error reporting such as Sentry remains a separate decision and must not become the normal application logger.

## Modules

### Platform

- Identity and Auth
- Users and RBAC
- Employees
- Organization, Legal Entity, and GST Registration
- Lookup Masters
- Documents
- Audit
- Notification Delivery Log
- Jobs

### Commercial

- Parties, Clients, Vendors, Introducers
- Leads
- Tenders
- Projects
- Milestones and Schedules
- EMD/SD

### Finance

- Accounting Core
- Income: Invoices, Client Receipts, Deductions
- Expense: Purchases, Vendor Bills, Direct Expenses
- Vendor Payments
- Employee Advances and Claims
- Subscriptions and Servers
- Banking and Reconciliation
- Tax Registers

### Operations and costing

- Inventory
- Salary Imports
- Employee Allocations
- Project Costing
- Reporting

## Dependency direction

```text
UI/API
  ↓
Application commands and queries
  ↓
Domain modules
  ↓
Database and infrastructure adapters
```

Modules may reference stable identifiers from another module. Cross-module side effects use a transactional outbox. A database commit must not succeed with a missing required journal or audit record.

## Transaction boundaries

The following happen atomically:

- Finalize invoice + allocate number + post journal + create audit/outbox events.
- Record receipt + allocate invoices + record deductions + post journal + create bank matching candidate.
- Approve request + record maker/checker + publish workflow event.
- Finalize vendor bill + post payable/input-tax journal.
- Record vendor payment + allocations/TDS + post journal.
- Post inventory receipt/consumption + cost entry where applicable.

External email, file processing, and non-critical notifications run after commit from the outbox.

## Source-of-truth hierarchy

| Concern | Authoritative source |
|---|---|
| Contract/delivery | Project and milestone records |
| Tax invoice | Finalized invoice and lines |
| Client remittance | Client receipt and allocations |
| Deduction lifecycle | Typed deduction and release records |
| Vendor liability | Finalized vendor bill |
| Bank reality | Imported/entered bank transaction |
| Accounting | Posted journal entry and lines |
| Dashboard/report cache | Derived view only |

## Reliability requirements

- Optimistic concurrency or row locks on financial state transitions.
- Database constraints for monetary and tax invariants.
- Unique posting keys for idempotency.
- Outbox retries with dead-letter visibility.
- Period locking.
- Immutable audit events.
- Daily exception checks for unbalanced, unposted, unmatched, and overdue records.

## Superseded architecture rules

Do not implement these rules from the old document:

- Simplified non-double-entry ledger
- Separate Billing Queue as a mandatory module
- One invoice per milestone
- Payment limited to one invoice
- Fixed-assets and depreciation module
- Node.js 20 runtime
- Soft delete on posted financial records
- Docker- or Docker Compose-based runtime
- Caddy-based application deployment
- Pino logging dependency
