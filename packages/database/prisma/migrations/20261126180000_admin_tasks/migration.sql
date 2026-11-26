CREATE TABLE "AdminTask" (
 "id" TEXT PRIMARY KEY,
 "title" TEXT NOT NULL CHECK (char_length("title") BETWEEN 3 AND 160),
 "description" TEXT NOT NULL DEFAULT '' CHECK (char_length("description")<=2000),
 "priority" TEXT NOT NULL DEFAULT 'NORMAL' CHECK ("priority" IN ('LOW','NORMAL','HIGH','URGENT')),
 "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','IN_PROGRESS','DONE','CANCELLED')),
 "assigneeId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
 "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
 "dueAt" TIMESTAMPTZ,
 "completedAt" TIMESTAMPTZ,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("status"='DONE')=("completedAt" IS NOT NULL))
);
CREATE INDEX "AdminTask_assignee_status_due_idx" ON "AdminTask"("assigneeId","status","dueAt");
CREATE INDEX "AdminTask_status_due_idx" ON "AdminTask"("status","dueAt");
