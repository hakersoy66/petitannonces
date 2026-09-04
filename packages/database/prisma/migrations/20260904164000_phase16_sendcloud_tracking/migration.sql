CREATE TABLE IF NOT EXISTS "ShippingWebhookEvent" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "trackingNumber" TEXT NULL,
  "status" TEXT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShippingWebhookEvent_provider_eventKey_key" UNIQUE ("provider","eventKey")
);
CREATE INDEX IF NOT EXISTS "ShippingWebhookEvent_trackingNumber_createdAt_idx" ON "ShippingWebhookEvent" ("trackingNumber","createdAt" DESC);
