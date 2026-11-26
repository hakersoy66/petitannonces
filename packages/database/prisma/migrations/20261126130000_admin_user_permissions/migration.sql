CREATE TABLE IF NOT EXISTS "AdminUserPermission" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
 "publicationBlocked" BOOLEAN NOT NULL DEFAULT FALSE,
 "messagingBlocked" BOOLEAN NOT NULL DEFAULT FALSE,
 "importBlocked" BOOLEAN NOT NULL DEFAULT FALSE,
 "storeCreationBlocked" BOOLEAN NOT NULL DEFAULT FALSE,
 "listingCap" INTEGER CHECK ("listingCap" BETWEEN 1 AND 1000000),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE OR REPLACE FUNCTION pa_admin_user_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blocked boolean; cap integer; occupied integer;
BEGIN
 IF NEW."status" NOT IN ('PENDING','PUBLISHED') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD."sellerId"=NEW."sellerId" AND OLD."status"=NEW."status" THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM "User" WHERE "id"=NEW."sellerId" FOR UPDATE;
 SELECT "publicationBlocked","listingCap" INTO blocked,cap FROM "AdminUserPermission" WHERE "userId"=NEW."sellerId";
 IF blocked IS TRUE THEN RAISE EXCEPTION 'admin_publication_blocked' USING ERRCODE='23514'; END IF;
 IF cap IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD."sellerId"=NEW."sellerId" AND OLD."status"='PUBLISHED' AND NEW."status"='PENDING' THEN RETURN NEW; END IF;
 END IF;
 SELECT count(*) INTO occupied FROM "Listing" WHERE "sellerId"=NEW."sellerId" AND "id"<>NEW."id"
 AND ("status"='PUBLISHED' OR (NEW."status"='PENDING' AND "status"='PENDING'));
 IF occupied>=cap THEN RAISE EXCEPTION 'admin_listing_cap_reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pa_admin_user_publication_guard ON "Listing";
CREATE TRIGGER pa_admin_user_publication_guard BEFORE INSERT OR UPDATE OF "status","sellerId" ON "Listing"
FOR EACH ROW EXECUTE FUNCTION pa_admin_user_publication_guard();
