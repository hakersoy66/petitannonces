CREATE TABLE IF NOT EXISTS "ListingMedia" (
  "id" TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE,
  "objectKey" TEXT NOT NULL UNIQUE,
  "publicUrl" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isCover" BOOLEAN NOT NULL DEFAULT FALSE,
  "altText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ListingMedia_listingId_status_sortOrder_idx" ON "ListingMedia"("listingId", "status", "sortOrder");
CREATE INDEX IF NOT EXISTS "ListingMedia_listingId_isCover_idx" ON "ListingMedia"("listingId", "isCover");
