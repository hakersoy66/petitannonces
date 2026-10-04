-- Influenceurs phase 4: passwordless sessions, negotiations, evidence and manual settlement.
CREATE TABLE IF NOT EXISTS "InfluencerAccessCode" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "partnerId" TEXT NOT NULL REFERENCES "InfluencerPartner"("id") ON DELETE CASCADE,
 "codeHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ NOT NULL,
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "usedAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "InfluencerAccessCode_partner_created_idx" ON "InfluencerAccessCode"("partnerId","createdAt" DESC);
CREATE TABLE IF NOT EXISTS "InfluencerPortalSession" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "partnerId" TEXT NOT NULL REFERENCES "InfluencerPartner"("id") ON DELETE CASCADE,
 "tokenHash" TEXT NOT NULL UNIQUE,
 "expiresAt" TIMESTAMPTZ NOT NULL,
 "revokedAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "InfluencerPortalSession_partner_idx" ON "InfluencerPortalSession"("partnerId","expiresAt");
CREATE TABLE IF NOT EXISTS "InfluencerProposal" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "campaignId" TEXT NOT NULL REFERENCES "InfluencerCampaign"("id") ON DELETE CASCADE,
 "partnerId" TEXT NOT NULL REFERENCES "InfluencerPartner"("id") ON DELETE CASCADE,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "feeMinor" INTEGER NOT NULL CHECK("feeMinor" BETWEEN 0 AND 100000000),
 "deliverables" TEXT NOT NULL,
 "terms" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'OFFERED' CHECK("status" IN ('OFFERED','COUNTERED','ACCEPTED','DECLINED','EXPIRED')),
 "counterFeeMinor" INTEGER CHECK("counterFeeMinor" BETWEEN 0 AND 100000000),
 "counterMessage" TEXT,
 "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT(NOW()+ INTERVAL '14 days'),
 "identityName" TEXT,
 "identityAddress" TEXT,
 "taxResidence" TEXT,
 "consentDigest" TEXT,
 "consentSnapshot" TEXT,
 "consentAt" TIMESTAMPTZ,
 "consentIpHash" TEXT,
 "legalStatus" TEXT NOT NULL DEFAULT 'AWAITING' CHECK("legalStatus" IN ('AWAITING','NEEDS_FORMAL_SIGNATURE','PENDING_VERIFICATION','VERIFIED')),
 "signedDocumentKey" TEXT,
 "verifiedAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE("campaignId","revision")
);
CREATE INDEX IF NOT EXISTS "InfluencerProposal_partner_created_idx" ON "InfluencerProposal"("partnerId","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "InfluencerProposal_campaign_status_idx" ON "InfluencerProposal"("campaignId","status");
CREATE TABLE IF NOT EXISTS "InfluencerEvidence" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 "campaignId" TEXT NOT NULL REFERENCES "InfluencerCampaign"("id") ON DELETE CASCADE,
 "partnerId" TEXT NOT NULL REFERENCES "InfluencerPartner"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK("kind" IN ('INSIGHTS_SCREENSHOT','MEDIA_KIT','SIGNED_CONTRACT')),
 "objectKey" TEXT NOT NULL UNIQUE,
 "originalName" TEXT NOT NULL,
 "mimeType" TEXT NOT NULL,
 "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" BETWEEN 1 AND 3145728),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "InfluencerEvidence_campaign_idx" ON "InfluencerEvidence"("campaignId","createdAt" DESC);
CREATE TABLE IF NOT EXISTS "InfluencerAuditEvent"(
 "id" BIGSERIAL PRIMARY KEY,
 "campaignId" TEXT NOT NULL REFERENCES "InfluencerCampaign"("id") ON DELETE CASCADE,
 "partnerId" TEXT NOT NULL REFERENCES "InfluencerPartner"("id") ON DELETE CASCADE,
 "action" TEXT NOT NULL,
 "actorKind" TEXT NOT NULL CHECK("actorKind" IN ('ADMIN','PARTNER')),
 "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "InfluencerAuditEvent_campaign_idx" ON "InfluencerAuditEvent"("campaignId","createdAt" DESC);
ALTER TABLE "InfluencerCampaign" ADD COLUMN IF NOT EXISTS "financeStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED';
ALTER TABLE "InfluencerCampaign" ADD COLUMN IF NOT EXISTS "paymentReference" TEXT;
ALTER TABLE "InfluencerCampaign" ADD COLUMN IF NOT EXISTS "paymentApprovedAt" TIMESTAMPTZ;
ALTER TABLE "InfluencerCampaign" ADD COLUMN IF NOT EXISTS "paymentPaidAt" TIMESTAMPTZ;
