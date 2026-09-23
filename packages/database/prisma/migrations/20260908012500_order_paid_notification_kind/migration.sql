CREATE OR REPLACE FUNCTION pa_order_paid_lifecycle()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'PAID' AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    UPDATE "Listing"
      SET "status" = 'SOLD', "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = NEW."listingId" AND "status" = 'PUBLISHED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
