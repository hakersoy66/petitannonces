CREATE TABLE IF NOT EXISTS "VehicleWarranty" (
  "listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,
  "commercialOffered" BOOLEAN NOT NULL DEFAULT FALSE,
  "commercialMonths" INTEGER,
  "commercialCoverage" TEXT,
  "commercialProvider" VARCHAR(120),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleWarranty_months_valid" CHECK ("commercialMonths" IS NULL OR ("commercialMonths" BETWEEN 1 AND 60)),
  CONSTRAINT "VehicleWarranty_commercial_consistency" CHECK (
    (NOT "commercialOffered" AND "commercialMonths" IS NULL AND "commercialCoverage" IS NULL AND "commercialProvider" IS NULL)
    OR ("commercialOffered" AND "commercialMonths" IS NOT NULL AND NULLIF(btrim("commercialCoverage"),'') IS NOT NULL)
  )
);
