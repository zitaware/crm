-- ADR-177: a vendor bill may have no project (company overhead); its legal
-- entity is then chosen directly.
ALTER TABLE "vendor_bills" ALTER COLUMN "project_id" DROP NOT NULL;
