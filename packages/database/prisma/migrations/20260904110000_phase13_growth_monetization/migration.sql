CREATE TYPE "PromotionType" AS ENUM ('URGENT','FEATURED','BUMP','SPONSORED','GALLERY');
CREATE TYPE "PromotionStatus" AS ENUM ('PENDING','ACTIVE','EXPIRED','CANCELED');
CREATE TYPE "CreditTransactionType" AS ENUM ('GRANT','PURCHASE','CONSUME','REFUND','ADJUSTMENT','EXPIRY');
CREATE TYPE "CouponType" AS ENUM ('PERCENT','FIXED','CREDITS');
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING','QUALIFIED','REWARDED','CANCELED');

CREATE TABLE "PromotionProduct" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "type" "PromotionType" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "durationHours" INTEGER,
  "creditCost" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionProduct_price_check" CHECK ("priceMinor" >= 0 AND "creditCost" >= 0)
);

CREATE TABLE "ListingPromotion" (
  "id" TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "status" "PromotionStatus" NOT NULL DEFAULT 'PENDING',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'DIRECT',
  "externalPaymentReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingPromotion_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE,
  CONSTRAINT "ListingPromotion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "ListingPromotion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PromotionProduct"("id") ON DELETE RESTRICT
);
CREATE INDEX "ListingPromotion_listingId_status_idx" ON "ListingPromotion"("listingId","status");
CREATE INDEX "ListingPromotion_userId_createdAt_idx" ON "ListingPromotion"("userId","createdAt");

CREATE TABLE "PromotionCreditWallet" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionCreditWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "PromotionCreditWallet_balance_check" CHECK ("balance" >= 0)
);

CREATE TABLE "PromotionCreditTransaction" (
  "id" TEXT PRIMARY KEY,
  "walletId" TEXT NOT NULL,
  "type" "CreditTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionCreditTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "PromotionCreditWallet"("id") ON DELETE CASCADE
);
CREATE INDEX "PromotionCreditTransaction_walletId_createdAt_idx" ON "PromotionCreditTransaction"("walletId","createdAt");

CREATE TABLE "Coupon" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "type" "CouponType" NOT NULL,
  "value" INTEGER NOT NULL,
  "currency" TEXT,
  "maxRedemptions" INTEGER,
  "redemptions" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Coupon_value_check" CHECK ("value" > 0)
);

CREATE TABLE "CouponRedemption" (
  "id" TEXT PRIMARY KEY,
  "couponId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "promotionId" TEXT,
  "discountMinor" INTEGER NOT NULL DEFAULT 0,
  "creditsGranted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE,
  CONSTRAINT "CouponRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "CouponRedemption_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "ListingPromotion"("id") ON DELETE SET NULL,
  UNIQUE("couponId","userId")
);

CREATE TABLE "ReferralCode" (
  "id" TEXT PRIMARY KEY,
  "ownerUserId" TEXT NOT NULL UNIQUE,
  "code" TEXT NOT NULL UNIQUE,
  "rewardCredits" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralCode_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE "Referral" (
  "id" TEXT PRIMARY KEY,
  "referralCodeId" TEXT NOT NULL,
  "referredUserId" TEXT NOT NULL UNIQUE,
  "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
  "qualifiedAt" TIMESTAMP(3),
  "rewardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referral_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE CASCADE,
  CONSTRAINT "Referral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE "GrowthEvent" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "eventName" TEXT NOT NULL,
  "channel" TEXT,
  "campaign" TEXT,
  "source" TEXT,
  "medium" TEXT,
  "properties" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GrowthEvent_eventName_occurredAt_idx" ON "GrowthEvent"("eventName","occurredAt");
CREATE INDEX "GrowthEvent_campaign_occurredAt_idx" ON "GrowthEvent"("campaign","occurredAt");

INSERT INTO "PromotionProduct" ("id","code","type","name","description","priceMinor","currency","durationHours","creditCost") VALUES
('promo_urgent','URGENT_7D','URGENT','Urgent','Badge Urgent pendant 7 jours',299,'EUR',168,1),
('promo_featured','FEATURED_7D','FEATURED','À la une','Mise en avant dans les résultats pendant 7 jours',699,'EUR',168,3),
('promo_bump','BUMP_NOW','BUMP','Remonter','Remonte l’annonce en tête des résultats',199,'EUR',1,1),
('promo_sponsored','SPONSORED_7D','SPONSORED','Sponsorisé','Visibilité sponsorisée pendant 7 jours',999,'EUR',168,5),
('promo_gallery','GALLERY_7D','GALLERY','Galerie','Format galerie premium pendant 7 jours',499,'EUR',168,2)
ON CONFLICT ("code") DO NOTHING;
