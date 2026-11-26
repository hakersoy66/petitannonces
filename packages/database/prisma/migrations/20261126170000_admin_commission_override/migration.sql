ALTER TABLE "AdminCommercialPermission" ADD COLUMN IF NOT EXISTS "commissionRateBps" INTEGER CHECK ("commissionRateBps" BETWEEN 0 AND 1000);
ALTER TABLE "AdminCommercialPermission" ADD COLUMN IF NOT EXISTS "commissionUntil" TIMESTAMPTZ;
ALTER TABLE "AdminCommercialPermission" ADD COLUMN IF NOT EXISTS "commissionCustomized" BOOLEAN NOT NULL DEFAULT FALSE;
