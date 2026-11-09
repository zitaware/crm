-- ADR-175: salary is confidential. employee.read_salary is needed to see an
-- employee's salary, its history, and the salary cost an allocation carries;
-- Admin, Accountant and CEO hold it, the staff roles do not.
INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES (gen_random_uuid(), 'employee.read_salary', 'employee', 'read_salary', 'Sees employee salaries')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid(), r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'employee.read_salary'
WHERE r."name" IN ('Admin', 'Accountant', 'CEO')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
