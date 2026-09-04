CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT','PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED','CANCELED','REFUNDED','DISPUTED');
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED','REQUIRES_ACTION','AUTHORIZED','CAPTURED','FAILED','CANCELED','PARTIALLY_REFUNDED','REFUNDED');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING','PROCESSING','SUCCEEDED','FAILED','CANCELED');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING','BLOCKED','PROCESSING','PAID','FAILED','CANCELED');
CREATE TYPE "LedgerEntryType" AS ENUM ('ORDER_GROSS','BUYER_FEE','PLATFORM_COMMISSION','SELLER_NET','REFUND','PAYOUT','ADJUSTMENT');

CREATE TABLE "MarketplaceOrder" (
  "id" TEXT PRIMARY KEY,
  "orderNumber" TEXT NOT NULL UNIQUE,
  "listingId" TEXT NOT NULL,
  "offerId" TEXT UNIQUE,
  "buyerId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "itemAmountMinor" INTEGER NOT NULL,
  "shippingAmountMinor" INTEGER NOT NULL DEFAULT 0,
  "buyerProtectionFeeMinor" INTEGER NOT NULL DEFAULT 0,
  "platformCommissionMinor" INTEGER NOT NULL DEFAULT 0,
  "sellerNetMinor" INTEGER NOT NULL,
  "totalAmountMinor" INTEGER NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "paymentProvider" TEXT,
  "providerCheckoutId" TEXT UNIQUE,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "paidAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceOrder_amounts_check" CHECK (
    "itemAmountMinor" >= 0 AND "shippingAmountMinor" >= 0 AND "buyerProtectionFeeMinor" >= 0 AND
    "platformCommissionMinor" >= 0 AND "sellerNetMinor" >= 0 AND "totalAmountMinor" >= 0
  )
);

CREATE INDEX "MarketplaceOrder_buyerId_createdAt_idx" ON "MarketplaceOrder"("buyerId", "createdAt");
CREATE INDEX "MarketplaceOrder_sellerId_status_idx" ON "MarketplaceOrder"("sellerId", "status");
CREATE INDEX "MarketplaceOrder_listingId_status_idx" ON "MarketplaceOrder"("listingId", "status");

CREATE TABLE "MarketplacePayment" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT UNIQUE,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplacePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "MarketplacePayment_amount_check" CHECK ("amountMinor" >= 0)
);
CREATE INDEX "MarketplacePayment_orderId_status_idx" ON "MarketplacePayment"("orderId", "status");

CREATE TABLE "MarketplaceRefund" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "providerRefundId" TEXT UNIQUE,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "reason" TEXT,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "MarketplaceRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "MarketplacePayment"("id") ON DELETE CASCADE,
  CONSTRAINT "MarketplaceRefund_amount_check" CHECK ("amountMinor" > 0)
);
CREATE INDEX "MarketplaceRefund_orderId_status_idx" ON "MarketplaceRefund"("orderId", "status");

CREATE TABLE "MarketplacePayout" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE,
  "sellerId" TEXT NOT NULL,
  "providerPayoutId" TEXT UNIQUE,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "availableAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplacePayout_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "MarketplacePayout_amount_check" CHECK ("amountMinor" >= 0)
);
CREATE INDEX "MarketplacePayout_sellerId_status_idx" ON "MarketplacePayout"("sellerId", "status");

CREATE TABLE "FinancialLedgerEntry" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "type" "LedgerEntryType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "reference" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE
);
CREATE INDEX "FinancialLedgerEntry_orderId_createdAt_idx" ON "FinancialLedgerEntry"("orderId", "createdAt");

CREATE TABLE "PaymentWebhookEvent" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("provider", "providerEventId")
);
