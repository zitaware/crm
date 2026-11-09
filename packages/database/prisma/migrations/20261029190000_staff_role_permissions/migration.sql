-- ADR-173: Project Manager and Hardware Manager (still the same set, ADR-139)
-- record project progress and see milestones and payment alerts; Employee no
-- longer deletes or re-files documents.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('project_progress.create', 'milestone.read', 'payment_alert.read')
WHERE r."name" IN ('Project Manager', 'Hardware Manager')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "role_permissions"
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "name" = 'Employee')
  AND "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" = 'document.manage');
