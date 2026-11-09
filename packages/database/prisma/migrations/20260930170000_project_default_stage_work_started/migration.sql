-- New projects start at Work Started (ADR-133). Existing rows keep their stage.
ALTER TABLE "projects" ALTER COLUMN "stage" SET DEFAULT 'WORK_STARTED';
