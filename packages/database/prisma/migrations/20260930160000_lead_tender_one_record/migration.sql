-- Tender number, date and deadline live on the lead (ADR-131).
-- Copy them from the newest tender already linked to that lead.
ALTER TABLE "leads" ADD COLUMN "tender_number" TEXT;
ALTER TABLE "leads" ADD COLUMN "tender_date" DATE;
ALTER TABLE "leads" ADD COLUMN "submission_deadline" DATE;

UPDATE "leads" AS lead
SET
  "tender_number" = tender."tender_number",
  "tender_date" = tender."tender_date",
  "submission_deadline" = tender."submission_deadline",
  "estimated_value" = COALESCE(lead."estimated_value", tender."estimated_value")
FROM (
  SELECT DISTINCT ON ("lead_id")
    "lead_id",
    "tender_number",
    "tender_date",
    "submission_deadline",
    "estimated_value"
  FROM "tenders"
  WHERE "lead_id" IS NOT NULL
  ORDER BY "lead_id", "created_at" DESC
) AS tender
WHERE lead."id" = tender."lead_id";
