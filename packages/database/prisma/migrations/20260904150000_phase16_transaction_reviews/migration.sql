CREATE TYPE "MarketplaceReviewDirection" AS ENUM ('BUYER_TO_SELLER','SELLER_TO_BUYER');

CREATE TABLE "MarketplaceReview" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,
  "reviewerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "revieweeId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "direction" "MarketplaceReviewDirection" NOT NULL,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceReview_order_reviewer_key" UNIQUE ("orderId","reviewerId")
);

CREATE INDEX "MarketplaceReview_reviewee_created_idx" ON "MarketplaceReview" ("revieweeId","createdAt" DESC);
CREATE INDEX "MarketplaceReview_reviewee_rating_idx" ON "MarketplaceReview" ("revieweeId","rating");
