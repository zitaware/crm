-- ADR-174: an Admin can log in as another user. The session records the
-- Admin and the Admin's own session to return to; the permission is the
-- Admin role's alone.
ALTER TABLE "sessions" ADD COLUMN "impersonator_user_id" UUID,
ADD COLUMN "impersonator_session_id" UUID;

INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES (gen_random_uuid(), 'user.impersonate', 'user', 'impersonate', 'Log in as another user')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'user.impersonate'
WHERE r."name" = 'Admin'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
