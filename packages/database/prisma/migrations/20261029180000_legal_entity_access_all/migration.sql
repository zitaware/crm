-- ADR-172: entity-wise data. A user sees only the legal entity on their own
-- employee record unless they hold legal_entity.access_all, which only the
-- Admin role is given.
INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES (gen_random_uuid(), 'legal_entity.access_all', 'legal_entity', 'access_all', 'Sees every legal entity''s data')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'legal_entity.access_all'
WHERE r."name" = 'Admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
