CREATE TABLE IF NOT EXISTS "ListingExtraPublication" (
 "listingId" TEXT PRIMARY KEY,
 "userId" TEXT NOT NULL,
 "checkoutSessionId" TEXT UNIQUE,
 "paidAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ListingExtraPublication_user_idx" ON "ListingExtraPublication" ("userId");
CREATE OR REPLACE FUNCTION pa_unsubscribed_professional_listing_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seller_kind text; occupied integer; cap integer;
BEGIN
 IF NEW."status" NOT IN ('PENDING','PUBLISHED') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."sellerId"=NEW."sellerId" AND OLD."status"=NEW."status" THEN RETURN NEW; END IF;
  IF OLD."sellerId"=NEW."sellerId" AND OLD."status" IN ('PUBLISHED','PENDING') THEN RETURN NEW; END IF;
 END IF;
 SELECT "kind"::text INTO seller_kind FROM "User" WHERE "id"=NEW."sellerId" FOR UPDATE;
 IF seller_kind IS DISTINCT FROM 'PROFESSIONNEL' THEN RETURN NEW; END IF;
 SELECT p."maxActiveListings" INTO cap FROM "ProfessionalSubscription" s JOIN "ProfessionalPlan" p ON p."id"=s."planId"
 WHERE s."userId"=NEW."sellerId" AND
 ((s."status"='TRIALING' AND s."trialEndsAt">CURRENT_TIMESTAMP)
 OR (s."status"='ACTIVE' AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd">CURRENT_TIMESTAMP)))
 ORDER BY p."maxActiveListings" DESC NULLS FIRST,s."createdAt" DESC LIMIT 1;
 IF NOT FOUND THEN cap:=10; END IF;
 IF cap IS NULL THEN RETURN NEW; END IF;
 IF EXISTS (SELECT 1 FROM "ListingExtraPublication" e WHERE e."listingId"=NEW."id" AND e."userId"=NEW."sellerId" AND e."paidAt" IS NOT NULL) THEN RETURN NEW; END IF;
 SELECT COUNT(*) INTO occupied FROM "Listing" l WHERE l."sellerId"=NEW."sellerId" AND l."id"<>NEW."id"
 AND l."status" IN ('PUBLISHED','PENDING') AND NOT EXISTS (SELECT 1 FROM "ListingExtraPublication" e WHERE e."listingId"=l."id" AND e."userId"=l."sellerId" AND e."paidAt" IS NOT NULL);
 IF occupied>=cap THEN RAISE EXCEPTION 'professional_plan_listing_limit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
