CREATE TYPE "ReturnRequestStatus" AS ENUM ('OPEN','APPROVED','REJECTED','PROCESSING','REFUNDED','CLOSED');

CREATE TABLE "MarketplaceReturnRequest" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "status" "ReturnRequestStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "MarketplaceReturnRequest_active_order_idx" ON "MarketplaceReturnRequest"("orderId") WHERE "status" IN ('OPEN','APPROVED','PROCESSING');
CREATE INDEX "MarketplaceReturnRequest_order_created_idx" ON "MarketplaceReturnRequest"("orderId","createdAt");
