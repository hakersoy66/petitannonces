CREATE TABLE IF NOT EXISTS "MarketplaceSellerAccount" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL DEFAULT 'stripe',
  "providerAccountId" TEXT NOT NULL UNIQUE,
  "country" TEXT NOT NULL DEFAULT 'FR',
  "detailsSubmitted" BOOLEAN NOT NULL DEFAULT FALSE,
  "chargesEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "payoutsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "onboardingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceSellerAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "MarketplaceSellerAccount_status_idx" ON "MarketplaceSellerAccount"("payoutsEnabled","onboardingStatus");
