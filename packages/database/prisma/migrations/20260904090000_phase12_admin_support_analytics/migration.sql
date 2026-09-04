CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN','PENDING_CUSTOMER','PENDING_INTERNAL','RESOLVED','CLOSED');
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TYPE "SupportTicketCategory" AS ENUM ('ACCOUNT','LISTING','PAYMENT','ORDER','SHIPPING','DISPUTE','PROFESSIONAL','COMPLIANCE','SAFETY','OTHER');
CREATE TYPE "SupportMessageAuthorType" AS ENUM ('CUSTOMER','AGENT','SYSTEM');

CREATE TABLE "SupportTicket" (
  "id" TEXT PRIMARY KEY,
  "reference" TEXT NOT NULL UNIQUE,
  "userId" TEXT,
  "category" "SupportTicketCategory" NOT NULL,
  "subject" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "assignedToUserId" TEXT,
  "orderId" TEXT,
  "listingId" TEXT,
  "conversationId" TEXT,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstResponseAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SupportTicket_status_priority_idx" ON "SupportTicket"("status","priority","lastMessageAt");
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId","createdAt");

CREATE TABLE "SupportTicketMessage" (
  "id" TEXT PRIMARY KEY,
  "ticketId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "authorType" "SupportMessageAuthorType" NOT NULL,
  "body" TEXT NOT NULL,
  "internalNote" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE
);
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId","createdAt");

CREATE TABLE "AdminAuditEvent" (
  "id" TEXT PRIMARY KEY,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminAuditEvent_actorUserId_createdAt_idx" ON "AdminAuditEvent"("actorUserId","createdAt");
CREATE INDEX "AdminAuditEvent_entityType_entityId_idx" ON "AdminAuditEvent"("entityType","entityId");

CREATE TABLE "DailyMarketplaceMetric" (
  "date" DATE PRIMARY KEY,
  "newUsers" INTEGER NOT NULL DEFAULT 0,
  "newListings" INTEGER NOT NULL DEFAULT 0,
  "publishedListings" INTEGER NOT NULL DEFAULT 0,
  "orders" INTEGER NOT NULL DEFAULT 0,
  "paidOrders" INTEGER NOT NULL DEFAULT 0,
  "gmvMinor" BIGINT NOT NULL DEFAULT 0,
  "platformRevenueMinor" BIGINT NOT NULL DEFAULT 0,
  "refundsMinor" BIGINT NOT NULL DEFAULT 0,
  "payoutsMinor" BIGINT NOT NULL DEFAULT 0,
  "disputesOpened" INTEGER NOT NULL DEFAULT 0,
  "supportTicketsOpened" INTEGER NOT NULL DEFAULT 0,
  "moderationCasesOpened" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
