CREATE TABLE IF NOT EXISTS "BlackFridayPromotionDiscount2026" (
  "promotionId" TEXT PRIMARY KEY REFERENCES "ListingPromotion"("id") ON DELETE CASCADE,
  "originalPriceMinor" INTEGER NOT NULL CHECK ("originalPriceMinor" > 0),
  "discountMinor" INTEGER NOT NULL CHECK ("discountMinor" > 0),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bf2026_discount_below_original" CHECK ("discountMinor" < "originalPriceMinor")
);
