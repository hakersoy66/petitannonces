CREATE TABLE IF NOT EXISTS "MarketplaceCaseWorkspace" (
  "id" TEXT PRIMARY KEY,
  "caseType" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceCaseWorkspace_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,
  CONSTRAINT "MarketplaceCaseWorkspace_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "MarketplaceCaseWorkspace_type_check" CHECK ("caseType" IN ('dispute','return','refund')),
  CONSTRAINT "MarketplaceCaseWorkspace_priority_check" CHECK ("priority" IN ('NORMAL','HIGH','URGENT')),
  UNIQUE("caseType","caseId")
);
CREATE INDEX IF NOT EXISTS "MarketplaceCaseWorkspace_assignee_idx" ON "MarketplaceCaseWorkspace" ("assignedToUserId","priority","updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "MarketplaceCaseWorkspace_order_idx" ON "MarketplaceCaseWorkspace" ("orderId","updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "MarketplaceCaseNote" (
  "id" TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceCaseNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "MarketplaceCaseWorkspace"("id") ON DELETE CASCADE,
  CONSTRAINT "MarketplaceCaseNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "MarketplaceCaseNote_workspace_created_idx" ON "MarketplaceCaseNote" ("workspaceId","createdAt" DESC);
