INSERT INTO "CategoryAttribute" (
  "id","categoryId","key","label","type","unit","required","filterable","searchable","sortOrder","config","createdAt","updatedAt"
)
SELECT
  'job_street_address_20260924', c."id", 'streetAddress', 'Adresse du lieu de travail', 'TEXT'::"AttributeType", NULL,
  FALSE, FALSE, FALSE, 45,
  '{"placeholder":"Ex. 12 rue de la République","help":"Adresse physique du poste. Ne renseignez pas votre adresse personnelle si ce n’est pas le lieu de travail."}'::jsonb,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Category" c
WHERE c."slug"='emploi'
ON CONFLICT ("categoryId","key") DO NOTHING;
