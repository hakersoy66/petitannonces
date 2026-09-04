ALTER TABLE "UserProfile"
  ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" TIMESTAMP(3) NULL;

CREATE TABLE IF NOT EXISTS "PhoneVerificationChallenge" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3) NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhoneVerificationChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PhoneVerificationChallenge_userId_createdAt_idx" ON "PhoneVerificationChallenge" ("userId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PhoneVerificationChallenge_phone_createdAt_idx" ON "PhoneVerificationChallenge" ("phone","createdAt" DESC);
