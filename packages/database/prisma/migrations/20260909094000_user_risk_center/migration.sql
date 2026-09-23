CREATE TABLE IF NOT EXISTS "UserRiskEvent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "weight" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRiskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserRiskEvent_weight_check" CHECK ("weight" >= 0 AND "weight" <= 100)
);
CREATE INDEX IF NOT EXISTS "UserRiskEvent_user_created_idx" ON "UserRiskEvent" ("userId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "UserRiskEvent_type_created_idx" ON "UserRiskEvent" ("eventType","createdAt" DESC);

CREATE TABLE IF NOT EXISTS "UserRiskProfile" (
  "userId" TEXT PRIMARY KEY,
  "score" INTEGER NOT NULL DEFAULT 0,
  "level" "FraudRiskLevel" NOT NULL DEFAULT 'LOW',
  "signals" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "messagingRestrictedUntil" TIMESTAMP(3),
  "offerRestrictedUntil" TIMESTAMP(3),
  "reviewRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "commerceReviewRequired" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastEventAt" TIMESTAMP(3),
  "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRiskProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserRiskProfile_score_check" CHECK ("score" >= 0 AND "score" <= 100)
);
CREATE INDEX IF NOT EXISTS "UserRiskProfile_level_score_idx" ON "UserRiskProfile" ("level","score" DESC,"updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "UserRiskProfile_review_idx" ON "UserRiskProfile" ("reviewRequired","score" DESC);
