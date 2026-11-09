-- ADR-170: an employee imported from Excel may not have a joining date yet.
ALTER TABLE "employees" ALTER COLUMN "joining_date" DROP NOT NULL;
