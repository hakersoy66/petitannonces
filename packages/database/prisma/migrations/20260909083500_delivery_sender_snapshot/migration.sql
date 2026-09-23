ALTER TABLE "MarketplaceDeliverySelection"
  ADD COLUMN IF NOT EXISTS "senderName" TEXT,
  ADD COLUMN IF NOT EXISTS "senderAddress1" TEXT,
  ADD COLUMN IF NOT EXISTS "senderAddress2" TEXT,
  ADD COLUMN IF NOT EXISTS "senderPostalCode" TEXT,
  ADD COLUMN IF NOT EXISTS "senderCity" TEXT,
  ADD COLUMN IF NOT EXISTS "senderCountryCode" TEXT,
  ADD COLUMN IF NOT EXISTS "senderPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "senderEmail" TEXT;
