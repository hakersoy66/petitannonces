CREATE TABLE IF NOT EXISTS "AdminSetting" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "AdminIntegration" (
  "provider" TEXT PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "secretCiphertext" TEXT,
  "updatedByUserId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AdminIntegration_enabled_idx" ON "AdminIntegration"("enabled");
