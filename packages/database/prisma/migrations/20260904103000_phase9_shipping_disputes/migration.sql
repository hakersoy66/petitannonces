CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING','LABEL_CREATED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','RETURNED','LOST','CANCELED');
CREATE TYPE "DeliveryConfirmationStatus" AS ENUM ('WAITING','BUYER_CONFIRMED','AUTO_CONFIRMED','DISPUTED');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN','UNDER_REVIEW','AWAITING_BUYER','AWAITING_SELLER','RESOLVED_BUYER','RESOLVED_SELLER','CLOSED');
CREATE TYPE "DisputeReason" AS ENUM ('ITEM_NOT_RECEIVED','ITEM_NOT_AS_DESCRIBED','DAMAGED_ITEM','COUNTERFEIT_SUSPECTED','MISSING_PARTS','WRONG_ITEM','OTHER');
CREATE TYPE "DisputeMessageKind" AS ENUM ('TEXT','SYSTEM','EVIDENCE');

CREATE TABLE "MarketplaceShipment" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE,
  "carrier" TEXT NOT NULL,
  "service" TEXT,
  "trackingNumber" TEXT,
  "trackingUrl" TEXT,
  "labelUrl" TEXT,
  "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
  "shippedAt" TIMESTAMP(3),
  "estimatedDeliveryAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastCarrierEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE
);
CREATE INDEX "MarketplaceShipment_tracking_idx" ON "MarketplaceShipment"("carrier", "trackingNumber");
CREATE INDEX "MarketplaceShipment_status_idx" ON "MarketplaceShipment"("status", "lastCarrierEventAt");

CREATE TABLE "BuyerProtectionWindow" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE,
  "confirmationStatus" "DeliveryConfirmationStatus" NOT NULL DEFAULT 'WAITING',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "payoutEligibleAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerProtectionWindow_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE
);
CREATE INDEX "BuyerProtectionWindow_endsAt_idx" ON "BuyerProtectionWindow"("confirmationStatus", "endsAt");

CREATE TABLE "MarketplaceDispute" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "openedById" TEXT NOT NULL,
  "reason" "DisputeReason" NOT NULL,
  "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "summary" TEXT NOT NULL,
  "resolution" TEXT,
  "refundAmountMinor" INTEGER,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "MarketplaceDispute_refund_check" CHECK ("refundAmountMinor" IS NULL OR "refundAmountMinor" >= 0)
);
CREATE UNIQUE INDEX "MarketplaceDispute_active_order_idx" ON "MarketplaceDispute"("orderId") WHERE "status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED');
CREATE INDEX "MarketplaceDispute_status_idx" ON "MarketplaceDispute"("status", "openedAt");

CREATE TABLE "DisputeMessage" (
  "id" TEXT PRIMARY KEY,
  "disputeId" TEXT NOT NULL,
  "authorId" TEXT,
  "kind" "DisputeMessageKind" NOT NULL DEFAULT 'TEXT',
  "body" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeMessage_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "MarketplaceDispute"("id") ON DELETE CASCADE
);
CREATE INDEX "DisputeMessage_dispute_created_idx" ON "DisputeMessage"("disputeId", "createdAt");

CREATE TABLE "DisputeEvidence" (
  "id" TEXT PRIMARY KEY,
  "disputeId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DisputeEvidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "MarketplaceDispute"("id") ON DELETE CASCADE,
  CONSTRAINT "DisputeEvidence_size_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0)
);
CREATE INDEX "DisputeEvidence_dispute_idx" ON "DisputeEvidence"("disputeId", "createdAt");