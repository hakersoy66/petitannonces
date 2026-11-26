ALTER TABLE "AdminTask" ADD COLUMN "automationKey" TEXT;
CREATE UNIQUE INDEX "AdminTask_active_automation_key" ON "AdminTask"("automationKey") WHERE "automationKey" IS NOT NULL AND status IN ('OPEN','IN_PROGRESS');
CREATE TABLE "AdminTaskRule" (
 "key" TEXT PRIMARY KEY CHECK ("key" IN ('LISTING_OVERDUE','SUPPORT_URGENT','DISPUTE_OPEN')),
 "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
 "lastRunAt" TIMESTAMPTZ,
 "lastCount" INTEGER NOT NULL DEFAULT 0,
 "lastOutcome" TEXT,
 "revision" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "AdminTaskRule" ("key") VALUES ('LISTING_OVERDUE'),('SUPPORT_URGENT'),('DISPUTE_OPEN');
