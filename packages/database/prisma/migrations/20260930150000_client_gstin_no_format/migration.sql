-- A client's GSTIN is optional text. The 15-character pattern check is removed
-- so a value that is not a statutory GSTIN can still be saved (ADR-130).
ALTER TABLE "client_profiles" DROP CONSTRAINT "chk_client_profiles_gstin_format";
