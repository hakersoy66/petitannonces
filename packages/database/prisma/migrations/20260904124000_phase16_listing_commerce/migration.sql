CREATE TABLE IF NOT EXISTS "ListingCommerceSettings" (
  "listingId" TEXT PRIMARY KEY,
  "acceptsOffers" BOOLEAN NOT NULL DEFAULT TRUE,
  "securePaymentEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "handDeliveryEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "mondialRelayEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "colissimoEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "packageWeightG" INTEGER,
  "packageLengthCm" INTEGER,
  "packageWidthCm" INTEGER,
  "packageHeightCm" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingCommerceSettings_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ListingCommerceSettings_packageWeightG_check" CHECK ("packageWeightG" IS NULL OR ("packageWeightG" > 0 AND "packageWeightG" <= 30000)),
  CONSTRAINT "ListingCommerceSettings_packageLengthCm_check" CHECK ("packageLengthCm" IS NULL OR ("packageLengthCm" > 0 AND "packageLengthCm" <= 200)),
  CONSTRAINT "ListingCommerceSettings_packageWidthCm_check" CHECK ("packageWidthCm" IS NULL OR ("packageWidthCm" > 0 AND "packageWidthCm" <= 200)),
  CONSTRAINT "ListingCommerceSettings_packageHeightCm_check" CHECK ("packageHeightCm" IS NULL OR ("packageHeightCm" > 0 AND "packageHeightCm" <= 200))
);

CREATE INDEX IF NOT EXISTS "ListingCommerceSettings_shipping_idx"
  ON "ListingCommerceSettings" ("mondialRelayEnabled", "colissimoEnabled", "handDeliveryEnabled");
