ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "iconKey" TEXT;
CREATE INDEX IF NOT EXISTS "Category_parentId_isActive_sortOrder_idx" ON "Category"("parentId","isActive","sortOrder");
