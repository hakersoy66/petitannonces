ALTER TABLE "ProfessionalPlan"
  ALTER COLUMN "code" TYPE TEXT
  USING "code"::text;

DROP TYPE IF EXISTS "ProfessionalPlanCode";