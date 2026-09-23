import { prisma } from "@pa/database";

export async function ensureReturnWorkflowSchema(){
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnCarrier" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnTrackingNumber" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnTrackingUrl" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnShippedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "sellerReceivedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "sellerNotReceivedAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "receiptNote" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT`);
}