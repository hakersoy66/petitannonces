CREATE TABLE IF NOT EXISTS "FollowSubscription" (
  "id" TEXT PRIMARY KEY,
  "followerUserId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowSubscription_followerUserId_fkey"
    FOREIGN KEY ("followerUserId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "FollowSubscription_targetType_check"
    CHECK ("targetType" IN ('USER','STORE')),
  CONSTRAINT "FollowSubscription_follower_target_key"
    UNIQUE ("followerUserId","targetType","targetId")
);

CREATE INDEX IF NOT EXISTS "FollowSubscription_target_idx"
  ON "FollowSubscription" ("targetType","targetId","createdAt");

CREATE INDEX IF NOT EXISTS "FollowSubscription_follower_idx"
  ON "FollowSubscription" ("followerUserId","createdAt" DESC);