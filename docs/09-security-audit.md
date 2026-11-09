# Security and Audit

## Identity

- No public self-registration.
- Admin-invited users.
- Short-lived access token.
- Rotating refresh token in secure, HTTP-only cookie.
- Refresh-token family revocation.
- Password reset token is hashed, expiring, and single-use.
- Account disablement revokes active sessions.
- MFA should be enabled for Admin and Accountant roles before production financial use.

## Authorization

Use role permissions plus per-user overrides.

Resolution:

1. Combine role grants.
2. Apply user grants.
3. Apply user revocations.
4. Revocation wins.

Common actions:

- create
- read
- update
- submit
- approve
- reject
- finalize
- void
- reverse
- reconcile
- lock
- export
- manage

Project Manager permissions may be scoped to assigned projects.

## Maker-checker

At minimum:

- Purchase request creator cannot approve it.
- Payment request creator cannot approve it.
- Reconciliation preparer should not perform final lock where staffing permits.
- High-impact manual journal creator should not approve/post their own entry.
- Accounting period reopen: the actor who locked a period can never be the one to reopen it (`SELF_APPROVAL_NOT_ALLOWED`, enforced in `FinancialYearService.transitionAccountingPeriod` and backed by the DB's `chk_accounting_periods_reopener_differs` check) — a different qualified actor must perform the reopen.

The first release has no amount slabs.

## Financial authorization

- Draft creation and finalization are separate permissions.
- Receipt reversal requires a reason and elevated permission.
- Period soft-close/lock/reopen share one permission (`accounting_period.lock`, held by Admin and Accountant) with a mandatory reason on every transition and a full audit trail; reopen's real safeguard is the maker-checker actor check above, not a separate Admin-only permission.
- Manual journal posting is restricted to Accountant/Admin.
- Posted financial records are never editable through generic CRUD endpoints.

## Audit events

Audit events are append-only and include:

- organization and legal entity where applicable
- entity type and ID
- action
- actor ID and actor-email snapshot
- old/new structured values or domain-event payload
- reason
- correlation/request ID
- IP address
- user agent
- timestamp in UTC
- impersonation/delegation context if ever supported

Financial events must capture the business command, not only low-level row updates.

## Audit coverage

Mandatory:

- Authentication/session security events
- User/role/permission changes
- Project stage/status changes
- Milestone and schedule changes
- Invoice draft/finalize/void/note actions
- Receipt, deduction, and release actions
- Purchase/payment approvals
- Vendor bill/payment postings
- Bank matches/unmatches and period locks
- Manual journal and accounting-period actions
- File upload/download/delete/version actions
- Export actions for sensitive reports

## Data protection

- TLS in transit.
- Managed encryption at rest for database and object storage.
- Secrets stored outside source code.
- Pre-signed object URLs with short expiry.
- Validate file type, size, checksum, and malware policy.
- Mask bank account numbers except approved finance views.
- Limit PAN/GST/bank exports to authorized users.
- Never log access tokens, passwords, full bank details, or uploaded document content.

## Organization isolation

Even with one organization:

- Every organization-owned query is scoped by server context.
- Never accept `organization_id` from the browser as authorization.
- Cross-entity selection is validated on the server.

## Database protection

- Least-privilege application database role.
- Separate migration role.
- Restrict direct production database access.
- Backups with restore tests.
- Constraints protect critical accounting invariants.
- Audit and journal tables disallow normal update/delete privileges.

## Operational controls

- Structured logs with correlation IDs.
- Alert on failed posting, duplicate posting, unbalanced attempts, repeated auth failure, period reopen, and high-risk exports.
- Dependency and container scanning in CI.
- Database backups and point-in-time recovery.
- Documented incident response and restore procedure before go-live.

