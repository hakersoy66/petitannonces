CREATE TABLE IF NOT EXISTS "SupportFaq" (
  "id" TEXT PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "category" "SupportTicketCategory" NOT NULL,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "sourceTicketId" TEXT UNIQUE,
  "published" BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportFaq_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "SupportFaq_category_published_idx" ON "SupportFaq"("category","published","sortOrder");
