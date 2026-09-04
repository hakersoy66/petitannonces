CREATE TABLE IF NOT EXISTS "ListingPublicationConsent" (
  "id" TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "termsAccepted" BOOLEAN NOT NULL,
  "rulesAccepted" BOOLEAN NOT NULL,
  "accuracyConfirmed" BOOLEAN NOT NULL,
  "professionalDisclosureConfirmed" BOOLEAN NOT NULL DEFAULT TRUE,
  "ipHash" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingPublicationConsent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ListingPublicationConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ListingPublicationConsent_listing_created_idx"
  ON "ListingPublicationConsent" ("listingId", "createdAt" DESC);
