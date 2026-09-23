-- 1 PA credit equals 1 EUR. Support cent-level PA values.
ALTER TABLE "PromotionCreditWallet" ALTER COLUMN "balance" TYPE NUMERIC(12,2) USING "balance"::numeric;
ALTER TABLE "PromotionCreditTransaction" ALTER COLUMN "amount" TYPE NUMERIC(12,2) USING "amount"::numeric;
ALTER TABLE "PromotionProduct" ALTER COLUMN "creditCost" TYPE NUMERIC(12,2) USING "creditCost"::numeric;
UPDATE "PromotionProduct" SET "creditCost" = ROUND(("priceMinor"::numeric / 100), 2);
