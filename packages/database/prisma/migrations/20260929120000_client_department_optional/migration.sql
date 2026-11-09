-- Client department is optional. Existing values stay as stored.
ALTER TABLE "client_profiles" ALTER COLUMN "department" DROP NOT NULL;
