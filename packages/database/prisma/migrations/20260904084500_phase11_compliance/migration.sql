CREATE TYPE "ConsentPurpose" AS ENUM ('ESSENTIAL','ANALYTICS','PERSONALIZATION','ADVERTISING');
CREATE TYPE "DataRequestType" AS ENUM ('ACCESS','EXPORT','RECTIFICATION','ERASURE','RESTRICTION','OBJECTION');
CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN','VERIFYING','IN_PROGRESS','COMPLETED','REJECTED','CANCELED');
CREATE TYPE "Dac7Status" AS ENUM ('NOT_REQUIRED','PENDING','READY','REPORTED','EXEMPT','BLOCKED');
CREATE TYPE "ProductSafetyStatus" AS ENUM ('NOT_REVIEWED','COMPLIANT','RESTRICTED','RECALLED','BLOCKED');

CREATE TABLE "LegalDocumentVersion" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contentHash" TEXT NOT NULL,
  "urlPath" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("code","version")
);

CREATE TABLE "LegalAcceptance" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipHash" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "LegalAcceptance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocumentVersion"("id") ON DELETE RESTRICT,
  UNIQUE("userId","documentId")
);

CREATE TABLE "CookieConsent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "anonymousId" TEXT,
  "purpose" "ConsentPurpose" NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'WEB',
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawnAt" TIMESTAMP(3),
  CONSTRAINT "CookieConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "CookieConsent_userId_purpose_recordedAt_idx" ON "CookieConsent"("userId","purpose","recordedAt");
CREATE INDEX "CookieConsent_anonymousId_purpose_recordedAt_idx" ON "CookieConsent"("anonymousId","purpose","recordedAt");

CREATE TABLE "PrivacyDataRequest" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" "DataRequestType" NOT NULL,
  "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
  "requestReference" TEXT NOT NULL UNIQUE,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "responseDueAt" TIMESTAMP(3),
  "resultUrl" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivacyDataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "PrivacyDataRequest_userId_status_idx" ON "PrivacyDataRequest"("userId","status");

CREATE TABLE "SellerTaxProfile" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "taxCountry" TEXT NOT NULL DEFAULT 'FR',
  "tin" TEXT,
  "birthDate" DATE,
  "birthPlace" TEXT,
  "businessRegistrationNumber" TEXT,
  "dac7Status" "Dac7Status" NOT NULL DEFAULT 'PENDING',
  "lastDueDiligenceAt" TIMESTAMP(3),
  "lastReportedYear" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerTaxProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE "SellerAnnualTaxSummary" (
  "id" TEXT PRIMARY KEY,
  "sellerTaxProfileId" TEXT NOT NULL,
  "calendarYear" INTEGER NOT NULL,
  "transactionCount" INTEGER NOT NULL DEFAULT 0,
  "grossConsiderationMinor" BIGINT NOT NULL DEFAULT 0,
  "feesWithheldMinor" BIGINT NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "reportedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SellerAnnualTaxSummary_profile_fkey" FOREIGN KEY ("sellerTaxProfileId") REFERENCES "SellerTaxProfile"("id") ON DELETE CASCADE,
  UNIQUE("sellerTaxProfileId","calendarYear")
);

CREATE TABLE "ListingProductSafety" (
  "id" TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL UNIQUE,
  "status" "ProductSafetyStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
  "manufacturerName" TEXT,
  "manufacturerPostalAddress" TEXT,
  "manufacturerEmail" TEXT,
  "responsiblePersonName" TEXT,
  "responsiblePersonPostalAddress" TEXT,
  "responsiblePersonEmail" TEXT,
  "productIdentifier" TEXT,
  "model" TEXT,
  "ean" TEXT,
  "ceMarked" BOOLEAN,
  "safetyWarning" TEXT,
  "recallReference" TEXT,
  "safetyGateUrl" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingProductSafety_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE
);
CREATE INDEX "ListingProductSafety_status_idx" ON "ListingProductSafety"("status");

CREATE TABLE "TraderConsumerDisclosure" (
  "id" TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL UNIQUE,
  "sellerIsTrader" BOOLEAN NOT NULL DEFAULT FALSE,
  "withdrawalRightApplies" BOOLEAN,
  "withdrawalPeriodDays" INTEGER,
  "withdrawalExceptionCode" TEXT,
  "legalGuaranteeNotice" TEXT,
  "mediationEntityName" TEXT,
  "mediationEntityUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TraderConsumerDisclosure_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE
);
