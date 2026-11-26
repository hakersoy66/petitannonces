CREATE TABLE IF NOT EXISTS "AdminListingArchive" (
 "listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,
 "previousStatus" TEXT NOT NULL,
 "archivedByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
 "reason" TEXT NOT NULL,
 "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AdminListingArchive_archivedAt_idx" ON "AdminListingArchive"("archivedAt");
CREATE OR REPLACE FUNCTION pa_admin_archived_listing_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."status" <> 'SUSPENDED' AND EXISTS (SELECT 1 FROM "AdminListingArchive" WHERE "listingId"=NEW."id") THEN
  RAISE EXCEPTION 'admin_listing_archived' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pa_admin_archived_listing_guard ON "Listing";
CREATE TRIGGER pa_admin_archived_listing_guard BEFORE UPDATE OF "status" ON "Listing" FOR EACH ROW EXECUTE FUNCTION pa_admin_archived_listing_guard();
