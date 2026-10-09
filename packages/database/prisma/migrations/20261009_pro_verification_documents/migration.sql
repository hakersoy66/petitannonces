CREATE TABLE IF NOT EXISTS "ProVerificationDocument" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('REGISTRY','AUTHORITY')),
  "objectKey" TEXT NOT NULL UNIQUE,
  "mimeType" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "applicantRole" TEXT NOT NULL,
  "applicantName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProVerificationDocument_user_idx" ON "ProVerificationDocument"("userId","createdAt" DESC);
