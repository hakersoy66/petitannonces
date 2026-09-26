import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

function slugify(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function validVehicleModel(value:string|null|undefined){const v=String(value??"").trim();return Boolean(v)&&v.length<=60&&!/^(?:19|20)\d{2}$/.test(v)&&!/\b\d{2,4}\s*(?:ch|cv|kw)\b/i.test(v)}

type VehicleFacet={make:string;model:string|null;count:bigint;updatedAt:Date;minPrice:bigint|null;maxPrice:bigint|null};
type PropertyFacet={transactionType:string;city:string;count:bigint;updatedAt:Date;minPrice:bigint|null;maxPrice:bigint|null};
type VacationFacet={city:string;count:bigint;updatedAt:Date;minPrice:bigint|null;maxPrice:bigint|null};

export async function registerSeoPublicRoutes(app: FastifyInstance) {
  app.get("/seo/sitemap-data", async (_request, reply) => {
    const [listings, stores, localPairs, vehicleFacets, propertyFacets, cityFacets, categoryFacets, vacationFacets] = await Promise.all([
      prisma.listing.findMany({
        where: { status: "PUBLISHED", slug: { not: null } },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 45000,
      }),
      prisma.store.findMany({
        where: { status: "ACTIVE" },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
      prisma.$queryRawUnsafe<Array<{ categorySlug: string; city: string; updatedAt: Date }>>(
        `WITH RECURSIVE anc AS (
           SELECT c."id" AS "descendantId",c."id" AS "ancestorId" FROM "Category" c
           UNION ALL
           SELECT anc."descendantId",p."id" AS "ancestorId"
           FROM anc JOIN "Category" cur ON cur."id"=anc."ancestorId" JOIN "Category" p ON p."id"=cur."parentId"
         )
         SELECT a."slug" AS "categorySlug",l."city",MAX(l."updatedAt") AS "updatedAt"
         FROM anc
         JOIN "Category" a ON a."id"=anc."ancestorId"
         JOIN "Listing" l ON l."categoryId"=anc."descendantId"
         WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND BTRIM(l."city")<>''
         GROUP BY a."slug",l."city"
         HAVING COUNT(l."id") >= 3
         ORDER BY COUNT(l."id") DESC,MAX(l."updatedAt") DESC
         LIMIT 10000`
      ),
      prisma.$queryRawUnsafe<VehicleFacet[]>(
        `SELECT v."make",NULLIF(BTRIM(v."model"),'') AS "model",COUNT(*)::bigint AS "count",MAX(l."updatedAt") AS "updatedAt",
                MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice"
         FROM "Listing" l JOIN "VehicleDetails" v ON v."listingId"=l."id"
         WHERE l."status"='PUBLISHED' AND v."make" IS NOT NULL AND BTRIM(v."make")<>''
         GROUP BY v."make",NULLIF(BTRIM(v."model"),'')
         ORDER BY COUNT(*) DESC,MAX(l."updatedAt") DESC LIMIT 5000`
      ),
      prisma.$queryRawUnsafe<PropertyFacet[]>(
        `SELECT p."transactionType"::text AS "transactionType",COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),'')) AS "city",
                COUNT(*)::bigint AS "count",MAX(l."updatedAt") AS "updatedAt",MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice"
         FROM "Listing" l JOIN "PropertyDetails" p ON p."listingId"=l."id"
         WHERE l."status"='PUBLISHED' AND COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),'')) IS NOT NULL
         GROUP BY p."transactionType",COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),''))
         HAVING COUNT(*) >= 3
         ORDER BY COUNT(*) DESC,MAX(l."updatedAt") DESC LIMIT 5000`
      ),
      prisma.$queryRawUnsafe<Array<{city:string;count:bigint;updatedAt:Date}>>(
        `SELECT l."city",COUNT(*)::bigint AS "count",MAX(l."updatedAt") AS "updatedAt"
         FROM "Listing" l
         WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND BTRIM(l."city")<>''
         GROUP BY l."city"
         ORDER BY COUNT(*) DESC,MAX(l."updatedAt") DESC
         LIMIT 10000`
      ),
      prisma.$queryRawUnsafe<Array<{slug:string;count:bigint;updatedAt:Date}>>(
        `WITH RECURSIVE anc AS (
           SELECT c."id" AS "descendantId",c."id" AS "ancestorId" FROM "Category" c
           UNION ALL
           SELECT anc."descendantId",p."id" AS "ancestorId"
           FROM anc JOIN "Category" cur ON cur."id"=anc."ancestorId" JOIN "Category" p ON p."id"=cur."parentId"
         )
         SELECT a."slug",COUNT(l."id")::bigint AS "count",MAX(l."updatedAt") AS "updatedAt"
         FROM anc
         JOIN "Category" a ON a."id"=anc."ancestorId"
         JOIN "Listing" l ON l."categoryId"=anc."descendantId" AND l."status"='PUBLISHED'
         GROUP BY a."slug"
         ORDER BY COUNT(l."id") DESC`
      ),
      prisma.$queryRawUnsafe<VacationFacet[]>(
        `WITH RECURSIVE vacation_categories AS (
           SELECT "id" FROM "Category" WHERE "slug"='vacances'
           UNION ALL
           SELECT c."id" FROM "Category" c JOIN vacation_categories vc ON c."parentId"=vc."id"
         )
         SELECT l."city",COUNT(*)::bigint AS "count",MAX(l."updatedAt") AS "updatedAt",
                MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice"
         FROM "Listing" l
         WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM vacation_categories)
           AND l."city" IS NOT NULL AND BTRIM(l."city")<>''
         GROUP BY l."city"
         ORDER BY COUNT(*) DESC,MAX(l."updatedAt") DESC
         LIMIT 5000`
      ),
    ]);
    const listingIds=listings.map(x=>x.slug).filter((slug):slug is string=>Boolean(slug));
    const imageRows=listingIds.length?await prisma.$queryRawUnsafe<Array<{slug:string;images:string[]}>>(
      `SELECT l."slug",ARRAY_AGG(lm."publicUrl" ORDER BY lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC) AS "images"
       FROM "Listing" l JOIN "ListingMedia" lm ON lm."listingId"=l."id"
       WHERE l."status"='PUBLISHED' AND l."slug"=ANY($1::text[]) AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL
       GROUP BY l."slug"`,listingIds
    ):[];
    const imagesBySlug=new Map(imageRows.map(row=>[row.slug,row.images.filter(Boolean).slice(0,8)] as const));
    const cityFacetMap=new Map<string,{city:string;slug:string;count:number;updatedAt:Date;largestVariantCount:number}>();
    for(const row of cityFacets){const slug=slugify(row.city);if(!slug)continue;const count=Number(row.count);const current=cityFacetMap.get(slug);if(!current){cityFacetMap.set(slug,{city:row.city,slug,count,updatedAt:row.updatedAt,largestVariantCount:count});continue}current.count+=count;if(row.updatedAt>current.updatedAt)current.updatedAt=row.updatedAt;if(count>current.largestVariantCount){current.city=row.city;current.largestVariantCount=count}}
    const normalizedCityFacets=[...cityFacetMap.values()].filter(x=>x.count>=3).map(({largestVariantCount,...x})=>x);
    reply.header("Cache-Control", "public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    return reply.send({
      listings:listings.map(x=>({...x,images:x.slug?(imagesBySlug.get(x.slug)??[]):[]})), stores, localPairs, cityFacets: normalizedCityFacets, categoryFacets: categoryFacets.map(x=>({...x,count:Number(x.count)})),
      vehicleFacets: vehicleFacets.filter(x=>!x.model||validVehicleModel(x.model)).map(x=>({...x,count:Number(x.count),minPrice:x.minPrice===null?null:Number(x.minPrice),maxPrice:x.maxPrice===null?null:Number(x.maxPrice)})),
      propertyFacets: propertyFacets.map(x=>({...x,count:Number(x.count),minPrice:x.minPrice===null?null:Number(x.minPrice),maxPrice:x.maxPrice===null?null:Number(x.maxPrice)})),
      vacationFacets: vacationFacets.map(x=>({...x,slug:slugify(x.city),count:Number(x.count),minPrice:x.minPrice===null?null:Number(x.minPrice),maxPrice:x.maxPrice===null?null:Number(x.maxPrice)})),
    });
  });

  app.get("/seo/vehicle-facets", async (_request, reply) => {
    const rows=await prisma.$queryRawUnsafe<VehicleFacet[]>(
      `SELECT v."make",NULLIF(BTRIM(v."model"),'') AS "model",COUNT(*)::bigint AS "count",MAX(l."updatedAt") AS "updatedAt",MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice"
       FROM "Listing" l JOIN "VehicleDetails" v ON v."listingId"=l."id"
       WHERE l."status"='PUBLISHED' AND v."make" IS NOT NULL AND BTRIM(v."make")<>''
       GROUP BY v."make",NULLIF(BTRIM(v."model"),'') ORDER BY COUNT(*) DESC LIMIT 100`);
    const byMake=new Map<string,{make:string;count:number;models:Array<{model:string;count:number}>}>();
    for(const row of rows){const key=row.make.toLowerCase();const cur=byMake.get(key)??{make:row.make,count:0,models:[]};cur.count+=Number(row.count);if(row.model&&validVehicleModel(row.model))cur.models.push({model:row.model,count:Number(row.count)});byMake.set(key,cur)}
    return reply.send({makes:[...byMake.values()].sort((a,b)=>b.count-a.count).slice(0,20)});
  });

  app.get("/seo/property-facets", async (_request, reply) => {
    const rows=await prisma.$queryRawUnsafe<PropertyFacet[]>(
      `SELECT p."transactionType"::text AS "transactionType",COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),'')) AS "city",COUNT(*)::bigint AS "count",MAX(l."updatedAt") AS "updatedAt",MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice"
       FROM "Listing" l JOIN "PropertyDetails" p ON p."listingId"=l."id"
       WHERE l."status"='PUBLISHED' AND COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),'')) IS NOT NULL
       GROUP BY p."transactionType",COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),'')) ORDER BY COUNT(*) DESC LIMIT 60`);
    return reply.send({items:rows.map(x=>({transactionType:x.transactionType,city:x.city,count:Number(x.count)}))});
  });

  app.get("/seo/vacation-facets", async (_request, reply) => {
    const rows=await prisma.$queryRawUnsafe<VacationFacet[]>(
      `WITH RECURSIVE vacation_categories AS (
         SELECT "id" FROM "Category" WHERE "slug"='vacances'
         UNION ALL
         SELECT c."id" FROM "Category" c JOIN vacation_categories vc ON c."parentId"=vc."id"
       )
       SELECT l."city",COUNT(*)::bigint AS "count",MAX(l."updatedAt") AS "updatedAt",
              MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice"
       FROM "Listing" l
       WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM vacation_categories)
         AND l."city" IS NOT NULL AND BTRIM(l."city")<>''
       GROUP BY l."city"
       ORDER BY COUNT(*) DESC,MAX(l."updatedAt") DESC
       LIMIT 100`);
    return reply.send({items:rows.map(x=>({city:x.city,slug:slugify(x.city),count:Number(x.count),updatedAt:x.updatedAt,minPrice:x.minPrice===null?null:Number(x.minPrice),maxPrice:x.maxPrice===null?null:Number(x.maxPrice)}))});
  });

  app.get("/seo/vacation/:city", async (request, reply) => {
    const p=z.object({city:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_route"});
    const rows=await prisma.$queryRawUnsafe<Array<{city:string}>>(
      `WITH RECURSIVE vacation_categories AS (
         SELECT "id" FROM "Category" WHERE "slug"='vacances'
         UNION ALL
         SELECT c."id" FROM "Category" c JOIN vacation_categories vc ON c."parentId"=vc."id"
       )
       SELECT DISTINCT l."city" FROM "Listing" l
       WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM vacation_categories)
         AND l."city" IS NOT NULL AND BTRIM(l."city")<>''`);
    const city=rows.find(x=>slugify(x.city)===p.data.city)?.city;if(!city)return reply.code(404).send({error:"not_found"});
    const [stats,types]=await Promise.all([
      prisma.$queryRawUnsafe<Array<{count:bigint;minPrice:bigint|null;maxPrice:bigint|null;updatedAt:Date}>>(
        `WITH RECURSIVE vacation_categories AS (
           SELECT "id" FROM "Category" WHERE "slug"='vacances'
           UNION ALL
           SELECT c."id" FROM "Category" c JOIN vacation_categories vc ON c."parentId"=vc."id"
         )
         SELECT COUNT(*)::bigint AS "count",MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice",MAX(l."updatedAt") AS "updatedAt"
         FROM "Listing" l WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM vacation_categories) AND LOWER(BTRIM(l."city"))=LOWER(BTRIM($1))`,city),
      prisma.$queryRawUnsafe<Array<{slug:string;name:string;count:bigint}>>(
        `WITH RECURSIVE vacation_categories AS (
           SELECT "id" FROM "Category" WHERE "slug"='vacances'
           UNION ALL
           SELECT c."id" FROM "Category" c JOIN vacation_categories vc ON c."parentId"=vc."id"
         )
         SELECT c."slug",c."name",COUNT(*)::bigint AS "count"
         FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId"
         WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM vacation_categories) AND LOWER(BTRIM(l."city"))=LOWER(BTRIM($1))
         GROUP BY c."slug",c."name" ORDER BY COUNT(*) DESC,c."name" ASC`,city),
    ]);
    const s=stats[0];const total=Number(s?.count??0n);
    return reply.send({city,slug:slugify(city),total,indexable:total>=3,minPrice:s?.minPrice===null?null:Number(s?.minPrice??0),maxPrice:s?.maxPrice===null?null:Number(s?.maxPrice??0),updatedAt:s?.updatedAt??new Date(),types:types.map(x=>({slug:x.slug,name:x.name,count:Number(x.count)}))});
  });

  async function vehicleMeta(makeSlug:string,modelSlug?:string){
    const rows=await prisma.$queryRawUnsafe<Array<{make:string;model:string|null}>>(
      `SELECT DISTINCT v."make",NULLIF(BTRIM(v."model"),'') AS "model" FROM "Listing" l JOIN "VehicleDetails" v ON v."listingId"=l."id" WHERE l."status"='PUBLISHED' AND v."make" IS NOT NULL`);
    const found=rows.find(r=>slugify(r.make)===makeSlug && (!modelSlug || (r.model&&validVehicleModel(r.model)&&slugify(r.model)===modelSlug)));
    if(!found)return null;
    const stats=await prisma.$queryRawUnsafe<Array<{count:bigint;minPrice:bigint|null;maxPrice:bigint|null;updatedAt:Date}>>(
      `SELECT COUNT(*)::bigint AS "count",MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice",MAX(l."updatedAt") AS "updatedAt"
       FROM "Listing" l JOIN "VehicleDetails" v ON v."listingId"=l."id"
       WHERE l."status"='PUBLISHED' AND LOWER(v."make")=LOWER($1) ${modelSlug?'AND LOWER(v."model")=LOWER($2)':''}`,
      ...(modelSlug?[found.make,found.model]:[found.make]));
    const s=stats[0];return{make:found.make,model:modelSlug?found.model:null,total:Number(s?.count??0n),minPrice:s?.minPrice===null?null:Number(s?.minPrice??0),maxPrice:s?.maxPrice===null?null:Number(s?.maxPrice??0),updatedAt:s?.updatedAt??new Date()};
  }

  app.get("/seo/vehicle/:make",async(request,reply)=>{const p=z.object({make:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_route"});const meta=await vehicleMeta(p.data.make);if(!meta)return reply.code(404).send({error:"not_found"});return reply.send(meta)});
  app.get("/seo/vehicle/:make/:model",async(request,reply)=>{const p=z.object({make:z.string().min(1),model:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_route"});const meta=await vehicleMeta(p.data.make,p.data.model);if(!meta)return reply.code(404).send({error:"not_found"});return reply.send(meta)});

  app.get("/seo/property/:transaction/:city",async(request,reply)=>{
    const p=z.object({transaction:z.enum(["vente","location"]),city:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_route"});
    const type=p.data.transaction==="vente"?"SALE":"RENTAL";
    const cities=await prisma.$queryRawUnsafe<Array<{city:string}>>(`SELECT DISTINCT COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),'')) AS "city" FROM "Listing" l JOIN "PropertyDetails" p ON p."listingId"=l."id" WHERE l."status"='PUBLISHED' AND p."transactionType"::text=$1`,type);
    const city=cities.find(x=>x.city&&slugify(x.city)===p.data.city)?.city;if(!city)return reply.code(404).send({error:"not_found"});
    const stats=await prisma.$queryRawUnsafe<Array<{count:bigint;minPrice:bigint|null;maxPrice:bigint|null;updatedAt:Date}>>(`SELECT COUNT(*)::bigint AS "count",MIN(l."priceMinor")::bigint AS "minPrice",MAX(l."priceMinor")::bigint AS "maxPrice",MAX(l."updatedAt") AS "updatedAt" FROM "Listing" l JOIN "PropertyDetails" p ON p."listingId"=l."id" WHERE l."status"='PUBLISHED' AND p."transactionType"::text=$1 AND LOWER(COALESCE(NULLIF(BTRIM(p."city"),''),NULLIF(BTRIM(l."city"),'')))=LOWER($2)`,type,city);
    const s=stats[0];return reply.send({transactionType:type,transactionLabel:type==="SALE"?"Vente":"Location",city,total:Number(s?.count??0n),minPrice:s?.minPrice===null?null:Number(s?.minPrice??0),maxPrice:s?.maxPrice===null?null:Number(s?.maxPrice??0),updatedAt:s?.updatedAt??new Date()});
  });
  app.get("/seo/observatoire", async (_request, reply) => {
    const [summary,cities,categories,weeks]=await Promise.all([
      prisma.$queryRawUnsafe<Array<{total:bigint;recent30:bigint;cities:bigint;categories:bigint}>>(
        `SELECT COUNT(*)::bigint AS "total",
          COUNT(*) FILTER (WHERE COALESCE("publishedAt","createdAt")>=NOW()-INTERVAL '30 days')::bigint AS "recent30",
          COUNT(DISTINCT NULLIF(BTRIM("city"),''))::bigint AS "cities",
          COUNT(DISTINCT "categoryId")::bigint AS "categories"
         FROM "Listing" WHERE "status"='PUBLISHED'`
      ),
      prisma.$queryRawUnsafe<Array<{city:string;count:bigint;recent30:bigint}>>(
        `SELECT "city",COUNT(*)::bigint AS "count",
          COUNT(*) FILTER (WHERE COALESCE("publishedAt","createdAt")>=NOW()-INTERVAL '30 days')::bigint AS "recent30"
         FROM "Listing"
         WHERE "status"='PUBLISHED' AND "city" IS NOT NULL AND BTRIM("city")<>''
         GROUP BY "city" HAVING COUNT(*)>=3
         ORDER BY COUNT(*) DESC,"recent30" DESC,"city" ASC LIMIT 20`
      ),
      prisma.$queryRawUnsafe<Array<{slug:string;name:string;count:bigint;recent30:bigint;priced:bigint;medianPrice:number|null}>>(
        `WITH RECURSIVE root_map AS (
          SELECT c."id",c."id" AS "rootId",c."slug" AS "rootSlug",c."name" AS "rootName"
          FROM "Category" c WHERE c."parentId" IS NULL AND c."isActive"=TRUE
          UNION ALL
          SELECT c."id",r."rootId",r."rootSlug",r."rootName"
          FROM "Category" c JOIN root_map r ON c."parentId"=r."id" WHERE c."isActive"=TRUE
        )
        SELECT r."rootSlug" AS "slug",r."rootName" AS "name",COUNT(*)::bigint AS "count",
          COUNT(*) FILTER (WHERE COALESCE(l."publishedAt",l."createdAt")>=NOW()-INTERVAL '30 days')::bigint AS "recent30",
          COUNT(*) FILTER (WHERE l."priceMinor" IS NOT NULL AND l."priceMinor">0)::bigint AS "priced",
          PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY l."priceMinor") FILTER (WHERE l."priceMinor" IS NOT NULL AND l."priceMinor">0)::float8 AS "medianPrice"
        FROM "Listing" l JOIN root_map r ON r."id"=l."categoryId"
        WHERE l."status"='PUBLISHED'
        GROUP BY r."rootSlug",r."rootName"
        ORDER BY COUNT(*) DESC,"recent30" DESC LIMIT 16`
      ),
      prisma.$queryRawUnsafe<Array<{week:Date;count:bigint}>>(
        `SELECT DATE_TRUNC('week',COALESCE("publishedAt","createdAt")) AS "week",COUNT(*)::bigint AS "count"
         FROM "Listing"
         WHERE "status"='PUBLISHED' AND COALESCE("publishedAt","createdAt")>=NOW()-INTERVAL '12 weeks'
         GROUP BY 1 ORDER BY 1 ASC`
      ),
    ]);
    const s=summary[0]??{total:0n,recent30:0n,cities:0n,categories:0n};
    reply.header("Cache-Control","public, max-age=300, s-maxage=1800, stale-while-revalidate=7200");
    return reply.send({
      generatedAt:new Date().toISOString(),
      summary:{total:Number(s.total),recent30:Number(s.recent30),cities:Number(s.cities),categories:Number(s.categories)},
      cities:cities.map(x=>({city:x.city,slug:slugify(x.city),count:Number(x.count),recent30:Number(x.recent30)})),
      categories:categories.map(x=>({slug:x.slug,name:x.name,count:Number(x.count),recent30:Number(x.recent30),priced:Number(x.priced),medianPriceMinor:x.medianPrice===null?null:Math.round(Number(x.medianPrice))})),
      weeks:weeks.map(x=>({week:x.week,count:Number(x.count)})),
    });
  });

  app.get("/seo/cities/popular", async (_request, reply) => {
    const rows=await prisma.$queryRawUnsafe<Array<{city:string;count:bigint;updatedAt:Date}>>(`SELECT "city",COUNT(*)::bigint AS "count",MAX("updatedAt") AS "updatedAt" FROM "Listing" WHERE "status"='PUBLISHED' AND "city" IS NOT NULL AND BTRIM("city")<>'' GROUP BY "city" ORDER BY COUNT(*) DESC,MAX("updatedAt") DESC LIMIT 200`);
    const bySlug=new Map<string,{city:string;slug:string;count:number;updatedAt:Date;largest:number}>();
    for(const row of rows){const slug=slugify(row.city);if(!slug)continue;const count=Number(row.count);const current=bySlug.get(slug);if(!current){bySlug.set(slug,{city:row.city,slug,count,updatedAt:row.updatedAt,largest:count});continue}current.count+=count;if(row.updatedAt>current.updatedAt)current.updatedAt=row.updatedAt;if(count>current.largest){current.city=row.city;current.largest=count}}
    const cities=[...bySlug.values()].filter(x=>x.count>=3).sort((a,b)=>b.count-a.count||a.city.localeCompare(b.city,"fr")).slice(0,12).map(({largest,...x})=>x);
    reply.header("Cache-Control","public, max-age=300, s-maxage=900, stale-while-revalidate=3600");
    return reply.send({cities});
  });

  app.get("/seo/city/:city", async (request, reply) => {
    const p=z.object({city:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_route"});
    const rows=await prisma.$queryRawUnsafe<Array<{city:string;count:bigint}>>(`SELECT "city",COUNT(*)::bigint AS "count" FROM "Listing" WHERE "status"='PUBLISHED' AND "city" IS NOT NULL AND BTRIM("city")<>'' GROUP BY "city" ORDER BY COUNT(*) DESC,MAX("updatedAt") DESC`);
    const matches=rows.filter(x=>slugify(x.city)===p.data.city);if(!matches.length)return reply.code(404).send({error:"not_found"});
    const resolved=matches[0]!.city;const variants=matches.map(x=>x.city);
    const [stats,categories,primaryCategories,items]=await Promise.all([
      prisma.$queryRawUnsafe<Array<{count:bigint;recent30:bigint;priced:bigint;medianPrice:number|null;updatedAt:Date}>>(`SELECT COUNT(*)::bigint AS "count",COUNT(*) FILTER (WHERE COALESCE("publishedAt","createdAt")>=NOW()-INTERVAL '30 days')::bigint AS "recent30",COUNT(*) FILTER (WHERE "priceMinor" IS NOT NULL AND "priceMinor">0)::bigint AS "priced",PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY "priceMinor") FILTER (WHERE "priceMinor" IS NOT NULL AND "priceMinor">0)::float8 AS "medianPrice",MAX("updatedAt") AS "updatedAt" FROM "Listing" WHERE "status"='PUBLISHED' AND "city" = ANY($1::text[])`,variants),
      prisma.$queryRawUnsafe<Array<{slug:string;name:string;count:bigint}>>(`SELECT c."slug",c."name",COUNT(*)::bigint AS "count" FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId" WHERE l."status"='PUBLISHED' AND l."city" = ANY($1::text[]) GROUP BY c."slug",c."name" ORDER BY COUNT(*) DESC,c."name" ASC LIMIT 12`,variants),
      prisma.$queryRawUnsafe<Array<{slug:string;name:string;count:bigint}>>(`WITH RECURSIVE anc AS (
         SELECT c."id" AS "descendantId",c."id" AS "ancestorId" FROM "Category" c
         UNION ALL
         SELECT anc."descendantId",p."id" AS "ancestorId"
         FROM anc JOIN "Category" cur ON cur."id"=anc."ancestorId" JOIN "Category" p ON p."id"=cur."parentId"
       )
       SELECT a."slug",a."name",COUNT(l."id")::bigint AS "count"
       FROM anc JOIN "Category" a ON a."id"=anc."ancestorId" JOIN "Listing" l ON l."categoryId"=anc."descendantId"
       WHERE l."status"='PUBLISHED' AND l."city" = ANY($1::text[]) AND a."parentId" IS NULL
       GROUP BY a."slug",a."name" HAVING COUNT(l."id")>=3
       ORDER BY COUNT(l."id") DESC,a."name" ASC LIMIT 10`,variants),
      prisma.$queryRawUnsafe<Array<{id:string;slug:string|null;title:string|null;priceMinor:number|null;currency:string;city:string|null;categoryName:string;categorySlug:string;categoryDomain:string;imageUrl:string|null;propertyTransactionType:string|null}>>(
        `SELECT l."id",l."slug",l."title",l."priceMinor",l."currency",l."city",c."name" AS "categoryName",c."slug" AS "categorySlug",c."domain"::text AS "categoryDomain",p."transactionType"::text AS "propertyTransactionType",
                (SELECT 'https://petitannonces.fr/api/media/watermark/' || lm."id" FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL ORDER BY lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC LIMIT 1) AS "imageUrl"
         FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId" LEFT JOIN "PropertyDetails" p ON p."listingId"=l."id"
         WHERE l."status"='PUBLISHED' AND l."slug" IS NOT NULL AND l."city" = ANY($1::text[])
         ORDER BY l."publishedAt" DESC NULLS LAST,l."updatedAt" DESC LIMIT 24`,variants),
    ]);
    const total=Number(stats[0]?.count??0n);
    const s=stats[0];
    return reply.send({city:resolved,slug:slugify(resolved),total,recent30:Number(s?.recent30??0n),priced:Number(s?.priced??0n),medianPriceMinor:s?.medianPrice===null?null:Math.round(Number(s?.medianPrice??0)),updatedAt:s?.updatedAt??new Date(),indexable:total>=3,categories:categories.map(x=>({slug:x.slug,name:x.name,count:Number(x.count)})),primaryCategories:primaryCategories.map(x=>({slug:x.slug,name:x.name,count:Number(x.count)})),items:items.map(x=>({id:x.id,slug:x.slug,title:x.title,priceMinor:x.priceMinor,currency:x.currency,city:x.city,imageUrl:x.imageUrl,category:{name:x.categoryName,slug:x.categorySlug,domain:x.categoryDomain},property:x.propertyTransactionType?{transactionType:x.propertyTransactionType}:null}))});
  });

  app.get("/seo/legacy-resolve", async (request, reply) => {
    const query=request.query as any; const q=query?.path; const raw=typeof q==="string"?q:""; const legacyCategoryId=typeof query?.c_id==="string"?query.c_id:"";
    const path=raw.replace(/^\/+|\/+$/g,""); if(!path)return reply.send({target:"/"});
    if(path==="support")return reply.send({target:"/assistance"});
    if(path==="tariffs"||path==="business-tariffs")return reply.send({target:"/professionnels"});
    if(path==="auctions")return reply.send({target:"/recherche"});
    if(path.startsWith("blog/")){
      if(/publier.*annonce|annonce.*publier|deposer.*annonce|annonce.*deposer/.test(path))return reply.send({target:"/deposer-annonce-gratuite"});
      if(/voiture|vehicule|automobile/.test(path))return reply.send({target:"/vendre-voiture"});
      return reply.send({target:"/blog"});
    }
    if(path==="loisirs/objets-de-collection")return reply.send({target:"/categorie/collection"});
    if(path==="electronique/telephones")return reply.send({target:"/categorie/telephones-smartphones"});
    if(path==="electronique/telephones/tablettes")return reply.send({target:"/categorie/tablettes-liseuses"});
    if(path==="electronique/telephones/telephones-mobiles")return reply.send({target:"/categorie/telephones-smartphones"});
    if(path==="electronique/photo"||path.startsWith("electronique/photo/"))return reply.send({target:"/categorie/photo-video"});
    if(path==="services/nettoyage")return reply.send({target:"/categorie/services-menage-entretien"});
    if(path==="logiciels")return reply.send({target:"/categorie/high-tech"});
    if(path==="fait-maison")return reply.send({target:"/categorie/maison-jardin"});
    if(path==="vehicules/motos")return reply.send({target:"/categorie/motos"});
    if(path==="vehicules/engins-de-chantier")return reply.send({target:"/categorie/materiel-btp-chantier"});
    if(path==="immobilier/locations/appartement")return reply.send({target:"/categorie/location-immobilier"});
    const parts=path.split("/").filter(Boolean); const last=parts.at(-1)??"";
    const regions=new Set(["auvergne-rhone-alpes","bourgogne-franche-comte","bretagne","centre-val-de-loire","corse","grand-est","hauts-de-france","ile-de-france","normandie","nouvelle-aquitaine","occitanie","pays-de-la-loire","provence-alpes-cote-d-azur","provence-alpes-cote-dazur"]);
    const knownCityTarget=async(citySlug:string)=>{const rows=await prisma.$queryRawUnsafe<Array<{city:string;count:bigint}>>(`SELECT "city",COUNT(*)::bigint AS "count" FROM "Listing" WHERE "status"='PUBLISHED' AND "city" IS NOT NULL AND BTRIM("city")<>'' GROUP BY "city"`);const found=rows.find(x=>slugify(x.city)===citySlug);if(!found)return null;return `/ville/${slugify(found.city)}`};
    if(parts[0]==="map"){
      const mapParts=parts.slice(1);const citySlug=mapParts.length>=2&&regions.has(mapParts[0]!)?(mapParts[1]??""):(mapParts[0]??"");
      if(!citySlug)return reply.send({target:"/recherche"});
      const legacyMapCategoryIds:Record<string,string>={"205":"electromenager","207":"electromenager","208":"electromenager","231":"sports-loisirs"};
      const mappedCategory=legacyMapCategoryIds[legacyCategoryId];
      if(mappedCategory){
        const localRows=await prisma.$queryRawUnsafe<Array<{city:string;count:bigint}>>(`WITH RECURSIVE category_tree AS (SELECT "id" FROM "Category" WHERE "slug"=$1 UNION ALL SELECT c."id" FROM "Category" c JOIN category_tree p ON c."parentId"=p."id") SELECT l."city",COUNT(*)::bigint AS "count" FROM "Listing" l WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM category_tree) AND l."city" IS NOT NULL AND BTRIM(l."city")<>'' GROUP BY l."city"`,mappedCategory);
        const local=localRows.find(x=>slugify(x.city)===citySlug&&Number(x.count)>=3);
        if(local)return reply.send({target:`/c/${mappedCategory}/${slugify(local.city)}`});
        return reply.send({target:`/categorie/${mappedCategory}`});
      }
      const target=await knownCityTarget(citySlug);
      if(target)return reply.send({target});
      const fallbackCity=citySlug.split("-").filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(" ");
      return reply.send({target:`/recherche?city=${encodeURIComponent(fallbackCity)}`});
    }
    const exact=await prisma.listing.findFirst({where:{status:"PUBLISHED",slug:last},select:{slug:true}});
    if(exact?.slug)return reply.send({target:`/annonce/${exact.slug}`});
    const suffix=await prisma.listing.findFirst({where:{status:"PUBLISHED",slug:{endsWith:last}},select:{slug:true}}).catch(()=>null);
    if(suffix?.slug)return reply.send({target:`/annonce/${suffix.slug}`});
    const legacyNumericId=last.match(/-(\d{1,10})$/)?.[1]??null;
    const numericMatch=legacyNumericId?await prisma.listing.findFirst({where:{status:"PUBLISHED",slug:{endsWith:`-${legacyNumericId}`}},select:{slug:true}}).catch(()=>null):null;
    if(numericMatch?.slug)return reply.send({target:`/annonce/${numericMatch.slug}`});
    const legacyElectronicTarget=/(refrigerateur|frigo|congelateur|lave-linge|lave-vaisselle|seche-linge|four|micro-ondes|aspirateur|cuisiniere)/.test(last)?"electromenager":"high-tech";
    const legacyCategoryAliases:Record<string,string>={"vehicules-pieces-et-accessoires":"pieces-accessoires-auto","vehicules-voitures":"voitures","vehicules-motos":"motos","immobilier-ventes-immobilieres":"vente-immobilier","immobilier-locations":"location-immobilier","maison":"maison-jardin","sport":"sports-loisirs","loisirs":"sports-loisirs","electronique":"high-tech","electronique-electromenager":legacyElectronicTarget,"beaute-et-sante":"services-beaute-bien-etre","famille":"enfants-bebe","materiaux-et-outils":"bricolage","objets-de-collection":"collection","informatique":"high-tech","jeux-pour-consoles-et-pc":"jeux-video"};
    const mappedLast=legacyCategoryAliases[last]??last;
    const cat=await prisma.category.findFirst({where:{slug:mappedLast,isActive:true},select:{slug:true}}).catch(()=>null);
    if(cat?.slug){
      const firstMapped=legacyCategoryAliases[parts[0]??""]??(parts[0]??"");
      const firstIsCategory=firstMapped?Boolean(await prisma.category.findFirst({where:{slug:firstMapped,isActive:true},select:{id:true}}).catch(()=>null)):false;
      const legacyCitySlug=parts.length>=2?(regions.has(parts[0]!)?(parts[1]??""):firstIsCategory?"":(parts[0]??"")):"";
      if(legacyCitySlug&&legacyCitySlug!==cat.slug){
        const localRows=await prisma.$queryRawUnsafe<Array<{city:string;count:bigint}>>(`WITH RECURSIVE category_tree AS (SELECT "id" FROM "Category" WHERE "slug"=$1 UNION ALL SELECT c."id" FROM "Category" c JOIN category_tree p ON c."parentId"=p."id") SELECT l."city",COUNT(*)::bigint AS "count" FROM "Listing" l WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM category_tree) AND l."city" IS NOT NULL AND BTRIM(l."city")<>'' GROUP BY l."city"`,cat.slug);
        const local=localRows.find(x=>slugify(x.city)===legacyCitySlug);
        if(local&&Number(local.count)>=3)return reply.send({target:`/c/${cat.slug}/${slugify(local.city)}`});
        if(local)return reply.send({target:`/recherche?category=${encodeURIComponent(cat.slug)}&city=${encodeURIComponent(local.city)}`});
        const fallbackCity=legacyCitySlug.split("-").filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(" ");
        return reply.send({target:`/recherche?category=${encodeURIComponent(cat.slug)}&city=${encodeURIComponent(fallbackCity)}`});
      }
      return reply.send({target:`/categorie/${cat.slug}`});
    }
    for(const part of parts.slice(0,-1).reverse()){
      const mapped=legacyCategoryAliases[part]??part;
      const category=await prisma.category.findFirst({where:{slug:mapped,isActive:true},select:{slug:true}}).catch(()=>null);
      if(category?.slug){
        const first=parts[0]??"";
        const firstMapped=legacyCategoryAliases[first]??first;
        const firstCategory=firstMapped?await prisma.category.findFirst({where:{slug:firstMapped,isActive:true},select:{id:true}}).catch(()=>null):null;
        const legacyCitySlug=parts.length>=2&&!regions.has(first)&&!firstCategory?first:"";
        if(legacyCitySlug){
          const localRows=await prisma.$queryRawUnsafe<Array<{city:string;count:bigint}>>(`WITH RECURSIVE category_tree AS (SELECT "id" FROM "Category" WHERE "slug"=$1 UNION ALL SELECT c."id" FROM "Category" c JOIN category_tree p ON c."parentId"=p."id") SELECT l."city",COUNT(*)::bigint AS "count" FROM "Listing" l WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM category_tree) AND l."city" IS NOT NULL AND BTRIM(l."city")<>'' GROUP BY l."city"`,category.slug);
          const local=localRows.find(x=>slugify(x.city)===legacyCitySlug);
          if(local&&Number(local.count)>=3)return reply.send({target:`/c/${category.slug}/${slugify(local.city)}`});
          if(local)return reply.send({target:`/recherche?category=${encodeURIComponent(category.slug)}&city=${encodeURIComponent(local.city)}`});
          const fallbackCity=legacyCitySlug.split("-").filter(Boolean).map(value=>value.charAt(0).toUpperCase()+value.slice(1)).join(" ");
          return reply.send({target:`/recherche?category=${encodeURIComponent(category.slug)}&city=${encodeURIComponent(fallbackCity)}`});
        }
        return reply.send({target:`/categorie/${category.slug}`});
      }
    }
    if(parts.length>=2&&regions.has(parts[0]!)){const target=await knownCityTarget(parts[1]??"");if(target)return reply.send({target});}
    if(parts.length===1){const target=await knownCityTarget(last);if(target)return reply.send({target});}
    return reply.code(404).send({error:"legacy_not_found"});
  });

}
