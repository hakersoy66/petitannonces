CREATE TABLE "MarketplaceDeliverySelection" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE,
  "carrier" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "shippingAmountMinor" INTEGER NOT NULL,
  "relayPointId" TEXT,
  "relayPointName" TEXT,
  "relayPointAddress1" TEXT,
  "relayPointPostalCode" TEXT,
  "relayPointCity" TEXT,
  "recipientPostalCode" TEXT NOT NULL,
  "recipientCountryCode" TEXT NOT NULL DEFAULT 'FR',
  "weightG" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceDeliverySelection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE
);

CREATE INDEX "MarketplaceDeliverySelection_carrier_idx" ON "MarketplaceDeliverySelection"("carrier");
