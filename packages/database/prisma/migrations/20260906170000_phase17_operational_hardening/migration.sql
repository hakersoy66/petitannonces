-- Formalize runtime-created operational tables and columns.
CREATE TABLE IF NOT EXISTS "SiteCreditWallet" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "balanceMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteCreditWallet_nonnegative" CHECK ("balanceMinor" >= 0)
);
CREATE TABLE IF NOT EXISTS "SiteCreditTransaction" (
  "id" TEXT PRIMARY KEY,
  "walletId" TEXT NOT NULL REFERENCES "SiteCreditWallet"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SiteCreditTransaction_wallet_created_idx" ON "SiteCreditTransaction"("walletId","createdAt" DESC);

CREATE TABLE IF NOT EXISTS "MarketplaceJobRun" (
  "id" TEXT PRIMARY KEY,
  "jobName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "result" JSONB,
  "error" TEXT
);
CREATE INDEX IF NOT EXISTS "MarketplaceJobRun_job_started_idx" ON "MarketplaceJobRun"("jobName","startedAt" DESC);
CREATE TABLE IF NOT EXISTS "MarketplaceJobDedupe" (
  "jobName" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("jobName","dedupeKey")
);

ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastError" TEXT;

ALTER TABLE "MarketplacePayout" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "MarketplacePayout" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MarketplacePayout" ADD COLUMN IF NOT EXISTS "lastProviderEvent" TEXT;
ALTER TABLE "MarketplacePayout" ADD COLUMN IF NOT EXISTS "lastProviderEventAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "MarketplacePayoutProviderEvent" (
  "id" TEXT PRIMARY KEY,
  "payoutId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL UNIQUE,
  "eventType" TEXT NOT NULL,
  "providerObjectId" TEXT,
  "status" TEXT,
  "failureReason" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MarketplacePayoutProviderEvent_payout_idx" ON "MarketplacePayoutProviderEvent"("payoutId","createdAt");
CREATE TABLE IF NOT EXISTS "MarketplaceUnmatchedProviderEvent" (
  "id" TEXT PRIMARY KEY,
  "providerEventId" TEXT NOT NULL UNIQUE,
  "eventType" TEXT NOT NULL,
  "providerObjectId" TEXT,
  "accountId" TEXT,
  "reason" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MarketplaceUnmatchedProviderEvent_created_idx" ON "MarketplaceUnmatchedProviderEvent"("createdAt");

ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnCarrier" TEXT;
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnTrackingNumber" TEXT;
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnTrackingUrl" TEXT;
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "returnShippedAt" TIMESTAMP(3);
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "sellerReceivedAt" TIMESTAMP(3);
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "sellerNotReceivedAt" TIMESTAMP(3);
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "receiptNote" TEXT;
ALTER TABLE "MarketplaceReturnRequest" ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;
