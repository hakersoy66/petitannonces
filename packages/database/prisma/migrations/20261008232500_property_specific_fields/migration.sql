-- Land-specific characteristics must be available when 'Terrain' is selected within broad real-estate sale or rental categories.
INSERT INTO "CategoryAttribute" ("id","categoryId","key","label","type","unit","required","filterable","searchable","sortOrder","createdAt","updatedAt")
SELECT md5(random()::text || clock_timestamp()::text), c."id", v."key", v."label", 'BOOLEAN'::"AttributeType", NULL, false, true, false, v."sortOrder", NOW(), NOW()
FROM "Category" c
CROSS JOIN (VALUES ('buildable','Constructible',200),('serviced','Viabilisé',210)) AS v("key","label","sortOrder")
WHERE c."slug" IN ('vente-immobilier','location-immobilier')
ON CONFLICT ("categoryId","key") DO NOTHING;
