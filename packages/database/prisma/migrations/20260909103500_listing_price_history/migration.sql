CREATE TABLE IF NOT EXISTS "ListingPriceHistory" (
  "id" TEXT PRIMARY KEY DEFAULT ('ph_' || md5(random()::text || clock_timestamp()::text)),
  "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE,
  "oldPriceMinor" INTEGER NOT NULL,
  "newPriceMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "changedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ListingPriceHistory_listing_changed_idx"
  ON "ListingPriceHistory"("listingId", "changedAt" DESC);

CREATE OR REPLACE FUNCTION pa_record_listing_price_change()
RETURNS trigger AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL
     AND OLD."priceMinor" IS NOT NULL
     AND NEW."priceMinor" IS NOT NULL
     AND OLD."priceMinor" IS DISTINCT FROM NEW."priceMinor" THEN
    INSERT INTO "ListingPriceHistory" ("listingId","oldPriceMinor","newPriceMinor","currency","changedAt")
    VALUES (NEW."id",OLD."priceMinor",NEW."priceMinor",COALESCE(NEW."currency",'EUR'),CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Listing_price_history_trigger" ON "Listing";
CREATE TRIGGER "Listing_price_history_trigger"
AFTER UPDATE OF "priceMinor" ON "Listing"
FOR EACH ROW EXECUTE FUNCTION pa_record_listing_price_change();
