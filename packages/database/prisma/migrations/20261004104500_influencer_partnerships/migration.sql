-- Petitannonces influenceurs : dossiers, campagnes, clics agrégés sans stockage d'IP.
CREATE TABLE IF NOT EXISTS "InfluencerPartner" (
 "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "platform" TEXT NOT NULL DEFAULT 'instagram' CHECK ("platform" IN ('instagram','tiktok','youtube','facebook')),
 "handle" TEXT NOT NULL,
 "email" TEXT,
 "followers" INTEGER NOT NULL DEFAULT 0 CHECK ("followers" >= 0),
 "averageViews" INTEGER NOT NULL DEFAULT 0 CHECK ("averageViews" >= 0),
 "franceAudiencePercent" NUMERIC(5,2) CHECK ("franceAudiencePercent" BETWEEN 0 AND 100),
 "suggestedFeeMinor" INTEGER NOT NULL DEFAULT 0 CHECK ("suggestedFeeMinor" >= 0),
 "notes" TEXT,
 "status" TEXT NOT NULL DEFAULT 'PROSPECT' CHECK ("status" IN ('PROSPECT','NEGOTIATING','PARTNER','ARCHIVED')),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT "InfluencerPartner_platform_handle_key" UNIQUE("platform", "handle")
);
CREATE TABLE IF NOT EXISTS "InfluencerCampaign" (
 "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "partnerId" TEXT NOT NULL REFERENCES "InfluencerPartner"("id") ON DELETE RESTRICT,
 "title" TEXT NOT NULL,
 "slug" TEXT NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT','NEGOTIATING','SCHEDULED','ACTIVE','COMPLETED','CANCELLED')),
 "deliverables" TEXT,
 "contentUrl" TEXT,
 "feeMinor" INTEGER NOT NULL DEFAULT 0 CHECK ("feeMinor" >= 0),
 "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID' CHECK ("paymentStatus" IN ('UNPAID','PENDING','PAID')),
 "publishedAt" TIMESTAMPTZ,
 "reportedViews" INTEGER NOT NULL DEFAULT 0 CHECK ("reportedViews" >= 0),
 "reportedLikes" INTEGER NOT NULL DEFAULT 0 CHECK ("reportedLikes" >= 0),
 "proofUrl" TEXT,
 "notes" TEXT,
 "clickCount" BIGINT NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "InfluencerCampaign_partner_idx" ON "InfluencerCampaign" ("partnerId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "InfluencerCampaign_status_idx" ON "InfluencerCampaign" ("status", "createdAt" DESC);
