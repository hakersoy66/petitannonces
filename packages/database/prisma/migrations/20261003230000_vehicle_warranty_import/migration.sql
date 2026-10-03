ALTER TABLE "VehicleWarranty"
  ADD COLUMN IF NOT EXISTS "importMonths" INTEGER,
  ADD COLUMN IF NOT EXISTS "importCoverage" TEXT,
  ADD COLUMN IF NOT EXISTS "importEvidence" VARCHAR(350);
ALTER TABLE "VehicleWarranty" ADD CONSTRAINT "VehicleWarranty_importMonths_valid" CHECK ("importMonths" IS NULL OR ("importMonths" BETWEEN 1 AND 60));
