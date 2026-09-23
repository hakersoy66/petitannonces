CREATE TABLE IF NOT EXISTS "UserBlock" (
  "id" TEXT PRIMARY KEY,
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_no_self" CHECK ("blockerId" <> "blockedId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_pair_idx" ON "UserBlock"("blockerId","blockedId");
CREATE INDEX IF NOT EXISTS "UserBlock_blocked_idx" ON "UserBlock"("blockedId","createdAt");
