ALTER TABLE "ListingCommerceSettings"
  ADD COLUMN IF NOT EXISTS "commissionPayer" TEXT NOT NULL DEFAULT 'SELLER';

ALTER TABLE "MarketplaceOrder"
  ADD COLUMN IF NOT EXISTS "commissionPayer" TEXT,
  ADD COLUMN IF NOT EXISTS "commissionRateBps" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ListingCommerceSettings_commissionPayer_check') THEN
    ALTER TABLE "ListingCommerceSettings" ADD CONSTRAINT "ListingCommerceSettings_commissionPayer_check" CHECK ("commissionPayer" IN ('SELLER','BUYER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='MarketplaceOrder_commissionPayer_check') THEN
    ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_commissionPayer_check" CHECK ("commissionPayer" IN ('SELLER','BUYER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='MarketplaceOrder_commissionRateBps_check') THEN
    ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_commissionRateBps_check" CHECK ("commissionRateBps" >= 0 AND "commissionRateBps" <= 10000);
  END IF;
END $$;
