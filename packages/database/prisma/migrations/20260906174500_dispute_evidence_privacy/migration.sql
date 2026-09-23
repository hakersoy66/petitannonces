ALTER TABLE "DisputeEvidence" ADD COLUMN IF NOT EXISTS "objectKey" TEXT;
CREATE INDEX IF NOT EXISTS "DisputeEvidence_objectKey_idx" ON "DisputeEvidence"("objectKey");
