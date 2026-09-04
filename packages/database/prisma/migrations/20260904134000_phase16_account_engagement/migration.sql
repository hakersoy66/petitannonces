CREATE TYPE "NotificationKind" AS ENUM ('SYSTEM','MESSAGE','OFFER','LISTING','SEARCH','WALLET','SECURITY');

CREATE TABLE "FavoriteListing" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FavoriteListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "FavoriteListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE,
  UNIQUE("userId","listingId")
);
CREATE INDEX "FavoriteListing_userId_createdAt_idx" ON "FavoriteListing"("userId","createdAt");

CREATE TABLE "SavedSearch" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "query" TEXT,
  "categorySlug" TEXT,
  "city" TEXT,
  "postalCode" TEXT,
  "minPriceMinor" INTEGER,
  "maxPriceMinor" INTEGER,
  "filters" JSONB,
  "alertEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "frequency" TEXT NOT NULL DEFAULT 'DAILY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "SavedSearch_userId_createdAt_idx" ON "SavedSearch"("userId","createdAt");

CREATE TABLE "UserNotification" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "kind" "NotificationKind" NOT NULL DEFAULT 'SYSTEM',
  "title" TEXT NOT NULL,
  "body" TEXT,
  "actionUrl" TEXT,
  "metadata" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "UserNotification_userId_readAt_createdAt_idx" ON "UserNotification"("userId","readAt","createdAt");
