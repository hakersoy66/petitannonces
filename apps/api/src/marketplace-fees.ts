import { prisma } from "@pa/database";

export type CommissionPayer = "SELLER" | "BUYER";

export const MARKETPLACE_COMMISSION_RATE_BPS = 1000;
export const MARKETPLACE_COMMISSION_RATE_PERCENT = 10;

let schemaPromise: Promise<void> | null = null;

async function initializeMarketplaceFeeSchema() {
 await prisma.$executeRawUnsafe(`ALTER TABLE "ListingCommerceSettings" ADD COLUMN IF NOT EXISTS "commissionPayer" TEXT NOT NULL DEFAULT 'SELLER'`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "commissionPayer" TEXT`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceOrder" ADD COLUMN IF NOT EXISTS "commissionRateBps" INTEGER`);
 await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ListingCommerceSettings_commissionPayer_check') THEN ALTER TABLE "ListingCommerceSettings" ADD CONSTRAINT "ListingCommerceSettings_commissionPayer_check" CHECK ("commissionPayer" IN ('SELLER','BUYER')); END IF; END $$`);
 await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='MarketplaceOrder_commissionPayer_check') THEN ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_commissionPayer_check" CHECK ("commissionPayer" IN ('SELLER','BUYER')); END IF; END $$`);
 await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='MarketplaceOrder_commissionRateBps_check') THEN ALTER TABLE "MarketplaceOrder" ADD CONSTRAINT "MarketplaceOrder_commissionRateBps_check" CHECK ("commissionRateBps">=0 AND "commissionRateBps"<=10000); END IF; END $$`);
}

export function ensureMarketplaceFeeSchema() {
 if (schemaPromise) return schemaPromise;
 schemaPromise = initializeMarketplaceFeeSchema().catch((error) => { schemaPromise = null; throw error; });
 return schemaPromise;
}

export function marketplaceQuote(itemAmountMinor: number, shippingAmountMinor: number, commissionPayer: CommissionPayer) {
 const platformCommissionMinor = Math.max(0, Math.round(itemAmountMinor * MARKETPLACE_COMMISSION_RATE_BPS / 10_000));
 const buyerServiceFeeMinor = commissionPayer === "BUYER" ? platformCommissionMinor : 0;
 const sellerNetMinor = Math.max(0, commissionPayer === "SELLER" ? itemAmountMinor - platformCommissionMinor : itemAmountMinor);
 const totalAmountMinor = itemAmountMinor + shippingAmountMinor + buyerServiceFeeMinor;
 return {
 itemAmountMinor,
 shippingAmountMinor,
 buyerServiceFeeMinor,
 buyerProtectionFeeMinor: buyerServiceFeeMinor,
 platformCommissionMinor,
 sellerNetMinor,
 totalAmountMinor,
 commissionPayer,
 commissionRateBps: MARKETPLACE_COMMISSION_RATE_BPS,
 };
}
