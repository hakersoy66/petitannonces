CREATE TABLE IF NOT EXISTS "AdminCommercialPermission" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
 "salesBlocked" BOOLEAN NOT NULL DEFAULT FALSE,
 "storeCap" INTEGER CHECK ("storeCap" BETWEEN 0 AND 100),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE OR REPLACE FUNCTION pa_admin_commercial_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE seller_status text; blocked boolean;
BEGIN
 SELECT "status"::text INTO seller_status FROM "User" WHERE "id"=NEW."sellerId" FOR UPDATE;
 SELECT "salesBlocked" INTO blocked FROM "AdminCommercialPermission" WHERE "userId"=NEW."sellerId";
 IF seller_status IS DISTINCT FROM 'ACTIVE' OR blocked IS TRUE THEN
  RAISE EXCEPTION 'admin_sales_blocked' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pa_admin_commercial_order_guard ON "MarketplaceOrder";
CREATE TRIGGER pa_admin_commercial_order_guard BEFORE INSERT ON "MarketplaceOrder" FOR EACH ROW EXECUTE FUNCTION pa_admin_commercial_order_guard();
CREATE OR REPLACE FUNCTION pa_admin_store_cap_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap integer; individual_cap integer; occupied integer; blocked boolean;
BEGIN
 IF NEW."status"='SUSPENDED' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD."ownerId"=NEW."ownerId" AND OLD."status"<>'SUSPENDED' THEN RETURN NEW; END IF;
 END IF;
 PERFORM 1 FROM "User" WHERE "id"=NEW."ownerId" FOR UPDATE;
 SELECT "storeCreationBlocked" INTO blocked FROM "AdminUserPermission" WHERE "userId"=NEW."ownerId";
 IF blocked IS TRUE THEN RAISE EXCEPTION 'admin_store_creation_blocked' USING ERRCODE='23514'; END IF;
 SELECT "storeCap" INTO individual_cap FROM "AdminCommercialPermission" WHERE "userId"=NEW."ownerId";
 SELECT p."maxStores" INTO cap FROM "ProfessionalSubscription" s JOIN "ProfessionalPlan" p ON p."id"=s."planId"
 WHERE s."userId"=NEW."ownerId" AND ((s."status"='ACTIVE' AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd">CURRENT_TIMESTAMP)) OR (s."status"='TRIALING' AND s."trialEndsAt">CURRENT_TIMESTAMP))
 ORDER BY p."maxStores" DESC,s."createdAt" DESC LIMIT 1;
 cap:=LEAST(COALESCE(cap,1),COALESCE(individual_cap,100));
 SELECT COUNT(*) INTO occupied FROM "Store" WHERE "ownerId"=NEW."ownerId" AND "id"<>NEW."id" AND "status"<>'SUSPENDED';
 IF occupied>=cap THEN RAISE EXCEPTION 'admin_store_cap_reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pa_admin_store_cap_guard ON "Store";
CREATE TRIGGER pa_admin_store_cap_guard BEFORE INSERT OR UPDATE OF "status","ownerId" ON "Store" FOR EACH ROW EXECUTE FUNCTION pa_admin_store_cap_guard();
