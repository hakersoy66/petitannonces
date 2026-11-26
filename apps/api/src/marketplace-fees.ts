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

export async function sellerCommissionPolicy(userId:string,db:Pick<typeof prisma,"$queryRaw">=prisma){
 const rows=await db.$queryRaw<Array<{rate:number;customized:boolean}>>`SELECT CASE WHEN "commissionRateBps" IS NOT NULL AND ("commissionUntil" IS NULL OR "commissionUntil">CURRENT_TIMESTAMP) THEN "commissionRateBps" ELSE 1000 END AS rate,"commissionCustomized" AS customized FROM "AdminCommercialPermission" WHERE "userId"=${userId}`;
 return rows[0]??{rate:MARKETPLACE_COMMISSION_RATE_BPS,customized:false};
}
export function marketplaceQuote(itemAmountMinor: number, shippingAmountMinor: number, commissionPayer: CommissionPayer, rateBps=MARKETPLACE_COMMISSION_RATE_BPS) {
  if(!Number.isInteger(rateBps)||rateBps<0||rateBps>1000)throw new Error("invalid_commission_rate");
  const platformCommissionMinor = Math.max(0, Math.round(itemAmountMinor * rateBps / 10_000));
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
    commissionRateBps: rateBps,
  };
}
