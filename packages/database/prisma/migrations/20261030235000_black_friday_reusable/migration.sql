-- Keep enrollments scoped to the edition; users opt in again next year.
ALTER TABLE "BlackFridayEntry2026" ADD COLUMN IF NOT EXISTS "edition" INTEGER NOT NULL DEFAULT 2026;
CREATE INDEX IF NOT EXISTS "BlackFridayEntry2026_edition_enrolled_idx" ON "BlackFridayEntry2026" ("edition","enrolledAt" DESC);
-- Retain the edition at the moment of payment, independently of later admin settings.
ALTER TABLE "BlackFridayProPurchase2026" ADD COLUMN IF NOT EXISTS "edition" INTEGER NOT NULL DEFAULT 2026;

ALTER TABLE "BlackFridayProPurchase2026" DROP CONSTRAINT IF EXISTS "bf_pro_matching_months";
ALTER TABLE "BlackFridayProPurchase2026" DROP CONSTRAINT IF EXISTS "BlackFridayProPurchase2026_paidMonths_check";
ALTER TABLE "BlackFridayProPurchase2026" DROP CONSTRAINT IF EXISTS "BlackFridayProPurchase2026_giftMonths_check";
ALTER TABLE "BlackFridayProPurchase2026" ADD CONSTRAINT "bf_pro_paid_months_range" CHECK ("paidMonths" BETWEEN 1 AND 24);
ALTER TABLE "BlackFridayProPurchase2026" ADD CONSTRAINT "bf_pro_gift_months_range" CHECK ("giftMonths" BETWEEN 0 AND 72);
