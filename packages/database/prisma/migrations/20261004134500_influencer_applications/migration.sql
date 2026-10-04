-- Candidatures publiques séparées des partenaires et des campagnes.
CREATE TABLE IF NOT EXISTS "InfluencerApplication" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('instagram','tiktok','youtube','facebook')),
  "handle" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "followers" INTEGER NOT NULL CHECK ("followers" >= 0),
  "averageViews" INTEGER NOT NULL CHECK ("averageViews" >= 0),
  "franceAudiencePercent" NUMERIC(5,2) CHECK ("franceAudiencePercent" BETWEEN 0 AND 100),
  "requestedFeeMinor" INTEGER NOT NULL DEFAULT 0 CHECK ("requestedFeeMinor" >= 0),
  "mediaKitUrl" TEXT,
  "message" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "InfluencerApplication_pending_unique_idx"
 ON "InfluencerApplication" ("platform", lower("handle")) WHERE "status"='PENDING';
CREATE INDEX IF NOT EXISTS "InfluencerApplication_status_created_idx"
 ON "InfluencerApplication" ("status","createdAt" DESC);
