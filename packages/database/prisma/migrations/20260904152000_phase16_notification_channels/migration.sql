ALTER TABLE "UserNotificationPreference"
  ADD COLUMN IF NOT EXISTS "inAppMessages" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "inAppOffers" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "inAppListingUpdates" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS "NotificationDeliveryOutbox" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "notificationId" TEXT NULL,
  "eventKind" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT NULL,
  "sentAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDeliveryOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationDeliveryOutbox_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "UserNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "NotificationDeliveryOutbox_channel_check" CHECK ("channel" IN ('EMAIL','PUSH')),
  CONSTRAINT "NotificationDeliveryOutbox_status_check" CHECK ("status" IN ('PENDING','PROCESSING','SENT','FAILED'))
);

CREATE INDEX IF NOT EXISTS "NotificationDeliveryOutbox_status_availableAt_idx" ON "NotificationDeliveryOutbox" ("status","availableAt");
CREATE INDEX IF NOT EXISTS "NotificationDeliveryOutbox_userId_createdAt_idx" ON "NotificationDeliveryOutbox" ("userId","createdAt" DESC);
