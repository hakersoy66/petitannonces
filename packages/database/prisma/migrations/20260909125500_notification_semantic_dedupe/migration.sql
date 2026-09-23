ALTER TABLE "UserNotification"
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

ALTER TABLE "NotificationDeliveryOutbox"
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "UserNotification_userId_dedupeKey_key"
  ON "UserNotification" ("userId","dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationDeliveryOutbox_user_channel_dedupeKey_key"
  ON "NotificationDeliveryOutbox" ("userId","channel","dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;
