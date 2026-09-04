CREATE TYPE "ReportTargetType" AS ENUM ('LISTING','USER','MESSAGE','STORE');
CREATE TYPE "ReportReason" AS ENUM ('SCAM','COUNTERFEIT','PROHIBITED_ITEM','HARASSMENT','SPAM','MISLEADING','DUPLICATE','SAFETY','OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN','TRIAGED','UNDER_REVIEW','ACTIONED','DISMISSED','CLOSED');
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN','IN_REVIEW','ACTION_REQUIRED','RESOLVED','CLOSED');
CREATE TYPE "ModerationActionType" AS ENUM ('NONE','WARNING','HIDE_LISTING','SUSPEND_LISTING','REMOVE_LISTING','SUSPEND_USER','BAN_USER','RESTRICT_MESSAGING','STORE_SUSPEND');
CREATE TYPE "AppealStatus" AS ENUM ('OPEN','UNDER_REVIEW','UPHELD','OVERTURNED','PARTIALLY_OVERTURNED','CLOSED');
CREATE TYPE "FraudRiskLevel" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');

CREATE TABLE "TrustReport" (
  "id" TEXT PRIMARY KEY,
  "reporterId" TEXT,
  "targetType" "ReportTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" "ReportReason" NOT NULL,
  "details" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "source" TEXT NOT NULL DEFAULT 'USER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TrustReport_target_idx" ON "TrustReport"("targetType","targetId","status");
CREATE INDEX "TrustReport_created_idx" ON "TrustReport"("status","createdAt");

CREATE TABLE "FraudRiskAssessment" (
  "id" TEXT PRIMARY KEY,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "level" "FraudRiskLevel" NOT NULL,
  "signals" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "modelVersion" TEXT NOT NULL DEFAULT 'rules-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FraudRiskAssessment_score_check" CHECK ("score" >= 0 AND "score" <= 100)
);
CREATE INDEX "FraudRiskAssessment_subject_idx" ON "FraudRiskAssessment"("subjectType","subjectId","createdAt");
CREATE INDEX "FraudRiskAssessment_level_idx" ON "FraudRiskAssessment"("level","createdAt");

CREATE TABLE "ModerationCase" (
  "id" TEXT PRIMARY KEY,
  "targetType" "ReportTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
  "priority" INTEGER NOT NULL DEFAULT 50,
  "riskScore" INTEGER NOT NULL DEFAULT 0,
  "assignedToUserId" TEXT,
  "decisionAction" "ModerationActionType",
  "decisionReasonCode" TEXT,
  "decisionStatement" TEXT,
  "automatedDecision" BOOLEAN NOT NULL DEFAULT FALSE,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationCase_risk_check" CHECK ("riskScore" >= 0 AND "riskScore" <= 100)
);
CREATE INDEX "ModerationCase_queue_idx" ON "ModerationCase"("status","priority","createdAt");
CREATE INDEX "ModerationCase_target_idx" ON "ModerationCase"("targetType","targetId");

CREATE TABLE "ModerationCaseReport" (
  "caseId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  PRIMARY KEY ("caseId","reportId"),
  CONSTRAINT "ModerationCaseReport_case_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE,
  CONSTRAINT "ModerationCaseReport_report_fkey" FOREIGN KEY ("reportId") REFERENCES "TrustReport"("id") ON DELETE CASCADE
);

CREATE TABLE "ModerationActionLog" (
  "id" TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" "ModerationActionType" NOT NULL,
  "reasonCode" TEXT,
  "statement" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationActionLog_case_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE
);
CREATE INDEX "ModerationActionLog_case_idx" ON "ModerationActionLog"("caseId","createdAt");

CREATE TABLE "ModerationAppeal" (
  "id" TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL,
  "appellantUserId" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "status" "AppealStatus" NOT NULL DEFAULT 'OPEN',
  "reviewedByUserId" TEXT,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationAppeal_case_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE CASCADE
);
CREATE INDEX "ModerationAppeal_queue_idx" ON "ModerationAppeal"("status","createdAt");
CREATE INDEX "ModerationAppeal_user_idx" ON "ModerationAppeal"("appellantUserId","createdAt");
