-- An employee belongs to one legal entity of the organization (ADR-154).
-- Nullable: existing employees of an organization with exactly one legal
-- entity are assigned to it below; anyone else is set in Employees.

ALTER TABLE "employees" ADD COLUMN "legal_entity_id" UUID;

UPDATE "employees" AS e
SET "legal_entity_id" = only_entity.id
FROM (
  SELECT "organization_id", (array_agg("id"))[1] AS id
  FROM "legal_entities"
  WHERE "deleted_at" IS NULL
  GROUP BY "organization_id"
  HAVING COUNT(*) = 1
) AS only_entity
WHERE e."organization_id" = only_entity."organization_id"
  AND e."legal_entity_id" IS NULL;

CREATE INDEX "idx_employees_legal_entity_id" ON "employees"("legal_entity_id");

ALTER TABLE "employees" ADD CONSTRAINT "fk_employees_legal_entity_org_consistent" FOREIGN KEY ("legal_entity_id", "organization_id") REFERENCES "legal_entities"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
