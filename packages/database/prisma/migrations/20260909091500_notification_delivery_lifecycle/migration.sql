ALTER TABLE "NotificationDeliveryOutbox"
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastProviderEventAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "providerError" TEXT;

CREATE INDEX IF NOT EXISTS "NotificationDeliveryOutbox_providerMessageId_idx"
  ON "NotificationDeliveryOutbox" ("providerMessageId");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryOutbox_deliveryStatus_idx"
  ON "NotificationDeliveryOutbox" ("deliveryStatus");

CREATE TABLE IF NOT EXISTS "NotificationProviderEvent" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL UNIQUE,
  "providerMessageId" TEXT,
  "eventType" TEXT NOT NULL,
  "deliveryStatus" TEXT,
  "providerError" TEXT,
  "eventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NotificationProviderEvent_message_idx"
  ON "NotificationProviderEvent" ("providerMessageId","createdAt");
