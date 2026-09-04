CREATE TYPE "DsaNoticeStatus" AS ENUM ('RECEIVED','UNDER_REVIEW','ACTIONED','NO_ACTION','CLOSED');

CREATE TABLE "DsaIllegalContentNotice" (
  "id" TEXT PRIMARY KEY,
  "reference" TEXT NOT NULL UNIQUE,
  "reporterUserId" TEXT,
  "reporterEmail" TEXT,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "contentUrl" TEXT,
  "legalBasis" TEXT,
  "explanation" TEXT NOT NULL,
  "goodFaithDeclaration" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "DsaNoticeStatus" NOT NULL DEFAULT 'RECEIVED',
  "decision" TEXT,
  "decisionReason" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DsaIllegalContentNotice_userId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "DsaIllegalContentNotice_status_receivedAt_idx" ON "DsaIllegalContentNotice"("status","receivedAt");
CREATE INDEX "DsaIllegalContentNotice_target_idx" ON "DsaIllegalContentNotice"("targetType","targetId");
