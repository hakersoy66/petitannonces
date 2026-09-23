ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "draftSavedAt" TIMESTAMPTZ;
UPDATE "Listing" SET "draftSavedAt"="updatedAt" WHERE "status"='DRAFT' AND "draftSavedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "Listing_status_draftSavedAt_idx" ON "Listing" ("status", "draftSavedAt");
