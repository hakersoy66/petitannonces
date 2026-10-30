-- Black Friday prepaid Pro purchase: pay N months once, receive N extra months.
-- Idempotent webhook confirmation and permanent audit.
CREATE TABLE IF NOT EXISTS "BlackFridayProPurchase2026" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "planId" TEXT NOT NULL REFERENCES "ProfessionalPlan"("id"),
  "paidMonths" INTEGER NOT NULL CHECK ("paidMonths" BETWEEN 1 AND 12),
  "giftMonths" INTEGER NOT NULL CHECK ("giftMonths" BETWEEN 1 AND 12),
  "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" > 0),
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "checkoutSessionId" TEXT UNIQUE,
  "subscriptionId" TEXT REFERENCES "ProfessionalSubscription"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','PAID','CANCELED')),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMPTZ,
  CONSTRAINT "bf_pro_matching_months" CHECK ("giftMonths" = "paidMonths")
);
CREATE INDEX IF NOT EXISTS "BlackFridayProPurchase2026_user_created_idx" ON "BlackFridayProPurchase2026" ("userId","createdAt" DESC);
