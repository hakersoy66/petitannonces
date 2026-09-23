CREATE TABLE IF NOT EXISTS "OAuthAccount" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google','apple')),
  "providerSubject" TEXT NOT NULL,
  "providerEmail" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAccount_provider_subject_key" ON "OAuthAccount"("provider","providerSubject");
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthAccount_user_provider_key" ON "OAuthAccount"("userId","provider");
CREATE INDEX IF NOT EXISTS "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

CREATE TABLE IF NOT EXISTS "OAuthState" (
  "id" TEXT PRIMARY KEY,
  "stateHash" TEXT NOT NULL UNIQUE,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('google','apple')),
  "codeVerifier" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "nextPath" TEXT NOT NULL DEFAULT '/mon-compte',
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "usedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "OAuthState_expiry_idx" ON "OAuthState"("expiresAt","usedAt");
