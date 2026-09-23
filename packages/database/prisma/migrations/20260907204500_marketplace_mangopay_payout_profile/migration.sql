CREATE TABLE IF NOT EXISTS "MarketplaceSellerPayoutProfile" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL DEFAULT 'mangopay',
  "personType" TEXT,
  "providerUserId" TEXT UNIQUE,
  "providerWalletId" TEXT UNIQUE,
  "providerIdentityVerificationId" TEXT,
  "providerRecipientId" TEXT UNIQUE,
  "userStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "kycLevel" TEXT NOT NULL DEFAULT 'LIGHT',
  "identityVerificationStatus" TEXT,
  "recipientStatus" TEXT NOT NULL DEFAULT 'NONE',
  "payoutsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "bankLast4" TEXT,
  "bankName" TEXT,
  "termsAcceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceSellerPayoutProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "MarketplaceSellerPayoutProfile_status_idx" ON "MarketplaceSellerPayoutProfile"("payoutsEnabled","kycLevel","recipientStatus");
