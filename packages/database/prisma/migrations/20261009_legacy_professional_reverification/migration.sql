CREATE TABLE IF NOT EXISTS "ProReverification" (
"userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
"status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
"startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
"dueAt" TIMESTAMPTZ NOT NULL,
"completedAt" TIMESTAMPTZ NULL,
"lastReminderStage" INTEGER NOT NULL DEFAULT -1,
"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProReverification_status_due_idx" ON "ProReverification"("status","dueAt");
INSERT INTO "ProReverification" ("userId","dueAt")
SELECT b."userId",CURRENT_TIMESTAMP + INTERVAL '14 days'
FROM "BusinessProfile" b JOIN "User" u ON u."id"=b."userId"
WHERE u."kind"='PROFESSIONNEL' AND b."verificationStatus"='VERIFIED'
AND COALESCE(b."verificationProvider",'') <> 'manual_authority_and_registry'
ON CONFLICT ("userId") DO NOTHING;
UPDATE "BusinessProfile" b
SET "verificationStatus"='PENDING',"verifiedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP
FROM "ProReverification" r WHERE r."userId"=b."userId"
AND r."status"='PENDING' AND b."verificationStatus"='VERIFIED';
UPDATE "Store" s SET "isVerified"=FALSE,"updatedAt"=CURRENT_TIMESTAMP
FROM "ProReverification" r
WHERE s."ownerId"=r."userId" AND r."status"='PENDING' AND s."isVerified"=TRUE;
