-- Revoke UPDATE/DELETE on the append-only audit trail from the application's
-- runtime DB role, per docs/09-security-audit.md ("audit and journal tables
-- disallow normal update/delete privileges"). No literal runtime role name
-- is documented anywhere in this project (docs/09, docs/14) — "zitaware_crm_app"
-- is a proposed name pending confirmation (see docs/12-decisions-log.md
-- ADR-035+ and the Phase 2 plan's open-items note). This is written
-- defensively so it is a no-op in any environment (local dev, CI) where
-- that role has not yet been provisioned by an ops runbook, while still
-- taking effect once the role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'zitaware_crm_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON audit_events FROM zitaware_crm_app';
  END IF;
END
$$;
