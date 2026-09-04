CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('WEB','IOS','ANDROID')),
  "endpoint" TEXT,
  "p256dh" TEXT,
  "auth" TEXT,
  "nativeToken" TEXT,
  "deviceLabel" TEXT,
  "userAgent" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint") WHERE "endpoint" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_nativeToken_key" ON "PushSubscription"("nativeToken") WHERE "nativeToken" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_platform_idx" ON "PushSubscription"("userId","platform");

CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "messages" BOOLEAN NOT NULL DEFAULT TRUE,
  "offers" BOOLEAN NOT NULL DEFAULT TRUE,
  "orders" BOOLEAN NOT NULL DEFAULT TRUE,
  "promotions" BOOLEAN NOT NULL DEFAULT FALSE,
  "savedSearches" BOOLEAN NOT NULL DEFAULT TRUE,
  "security" BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
