CREATE TABLE IF NOT EXISTS "AuthRateLimit" (
  "action" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3) NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("action", "keyHash")
);

CREATE INDEX IF NOT EXISTS "AuthRateLimit_blockedUntil_idx" ON "AuthRateLimit" ("blockedUntil");
CREATE INDEX IF NOT EXISTS "AuthRateLimit_updatedAt_idx" ON "AuthRateLimit" ("updatedAt");
