-- Reserve slots for pending ads and enforce the active cap on publication.
CREATE OR REPLACE FUNCTION pa_unsubscribed_professional_listing_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  seller_kind text;
  occupied integer;
BEGIN
  IF NEW."status" NOT IN ('PENDING','PUBLISHED') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."sellerId" = NEW."sellerId" AND OLD."status" = NEW."status" THEN RETURN NEW; END IF;
    IF OLD."sellerId" = NEW."sellerId" AND OLD."status" = 'PUBLISHED' AND NEW."status" = 'PENDING' THEN RETURN NEW; END IF;
  END IF;
  SELECT "kind"::text INTO seller_kind FROM "User" WHERE "id"=NEW."sellerId" FOR UPDATE;
  IF seller_kind IS DISTINCT FROM 'PROFESSIONNEL' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "ProfessionalSubscription" s
    WHERE s."userId"=NEW."sellerId" AND
      ((s."status"='TRIALING' AND s."trialEndsAt">CURRENT_TIMESTAMP)
       OR (s."status"='ACTIVE' AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd">CURRENT_TIMESTAMP)))) THEN
    RETURN NEW;
  END IF;
  SELECT COUNT(*) INTO occupied FROM "Listing" l
    WHERE l."sellerId"=NEW."sellerId" AND l."id"<>NEW."id"
      AND (l."status"='PUBLISHED' OR (NEW."status"='PENDING' AND l."status"='PENDING'));
  IF occupied >= 10 THEN
    RAISE EXCEPTION 'professional_free_listing_limit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pa_unsubscribed_professional_listing_limit ON "Listing";
CREATE TRIGGER pa_unsubscribed_professional_listing_limit
BEFORE INSERT OR UPDATE OF "status","sellerId" ON "Listing"
FOR EACH ROW EXECUTE FUNCTION pa_unsubscribed_professional_listing_limit();
