-- Legal entity logo, seal and authorized signature move to object storage
-- (ADR-193). Additive and nullable: existing rows keep their bytes columns
-- and are read from them until the image is next replaced. Rollback:
-- drop these three columns.
ALTER TABLE "legal_entities" ADD COLUMN "logo_storage_key" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "seal_storage_key" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "authorized_sign_storage_key" TEXT;
