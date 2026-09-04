CREATE UNIQUE INDEX IF NOT EXISTS "PromotionCreditTransaction_welcome_bonus_user_key"
ON "PromotionCreditTransaction" ("referenceType", "referenceId")
WHERE "referenceType" = 'WELCOME_BONUS';
