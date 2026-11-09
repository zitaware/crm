-- Phase 7 integration (ADR-098) — step 1 of 2: add the DRAFT status.
--
-- Deliberately alone in its own migration. Postgres will not let a new enum
-- value be USED in the same transaction that adds it, and step 2's CHECK
-- constraints reference 'DRAFT' directly. Prisma runs each migration in its
-- own transaction, so splitting them is what makes step 2 legal.

ALTER TYPE "SalaryImportStatus" ADD VALUE 'DRAFT';
