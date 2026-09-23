import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { requireAdminRoles } from "./rbac.js";
import { getGscSummary } from "./gsc-reporting.js";

const SNAPSHOT=process.env.GSC_SNAPSHOT_PATH??"/var/www/petitannonces/shared/gsc-snapshot.json";
async function snapshot(){try{return JSON.parse(await readFile(SNAPSHOT,"utf8"))}catch{return null}}
function slugify(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

type LocalRow={categorySlug:string;categoryName:string;city:string;count:bigint;recent30:bigint;priced:bigint;withMedia:bigint;avgDescriptionChars:number|null};
type DensityRow={slug:string;name:string;count:bigint;recent30:bigint};
type CityRow={city:string;count:bigint;recent30:bigint};

export async function registerAdminSeoRoutes(app:FastifyInstance){
 app.get("/admin/seo/status",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MARKETING"])},async(_request,reply)=>{
  const [published,categories,stores,missingTitle,missingDescription,missingSlug,missingMedia,localPairs,localRows,categoryDensity,cityDensity]=await Promise.all([
   prisma.listing.count({where:{status:"PUBLISHED"}}),
   prisma.category.count({where:{isActive:true}}),
   prisma.store.count({where:{status:"ACTIVE"}}),
   prisma.listing.count({where:{status:"PUBLISHED",OR:[{title:null},{title:""}]}}),
   prisma.listing.count({where:{status:"PUBLISHED",OR:[{description:null},{description:""}]}}),
   prisma.listing.count({where:{status:"PUBLISHED",slug:null}}),
   prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "Listing" l WHERE l."status"='PUBLISHED' AND NOT EXISTS (SELECT 1 FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL)`),
   prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM (SELECT c."slug",l."city" FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId" WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND BTRIM(l."city")<>'' GROUP BY c."slug",l."city") x`),
   prisma.$queryRawUnsafe<LocalRow[]>(`WITH RECURSIVE category_ancestors AS (
      SELECT c."id" AS "leafId",c."id" AS "ancestorId",c."slug",c."name",c."parentId" FROM "Category" c WHERE c."isActive"=TRUE
      UNION ALL
      SELECT ca."leafId",p."id",p."slug",p."name",p."parentId" FROM category_ancestors ca JOIN "Category" p ON p."id"=ca."parentId" WHERE p."isActive"=TRUE
    )
    SELECT ca."slug" AS "categorySlug",ca."name" AS "categoryName",l."city",
      COUNT(*)::bigint AS "count",
      COUNT(*) FILTER (WHERE COALESCE(l."publishedAt",l."createdAt")>=NOW()-INTERVAL '30 days')::bigint AS "recent30",
      COUNT(*) FILTER (WHERE l."priceMinor" IS NOT NULL)::bigint AS "priced",
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL))::bigint AS "withMedia",
      ROUND(AVG(LENGTH(COALESCE(l."description",''))))::int AS "avgDescriptionChars"
    FROM "Listing" l JOIN category_ancestors ca ON ca."leafId"=l."categoryId"
    WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND BTRIM(l."city")<>''
    GROUP BY ca."slug",ca."name",l."city"
    HAVING COUNT(*)>=1
    ORDER BY COUNT(*) DESC,"recent30" DESC,ca."name" ASC,l."city" ASC
    LIMIT 250`),
   prisma.$queryRawUnsafe<DensityRow[]>(`WITH RECURSIVE root_map AS (
      SELECT c."id",c."id" AS "rootId",c."slug" AS "rootSlug",c."name" AS "rootName" FROM "Category" c WHERE c."parentId" IS NULL AND c."isActive"=TRUE
      UNION ALL
      SELECT c."id",r."rootId",r."rootSlug",r."rootName" FROM "Category" c JOIN root_map r ON c."parentId"=r."id" WHERE c."isActive"=TRUE
    )
    SELECT r."rootSlug" AS "slug",r."rootName" AS "name",COUNT(*)::bigint AS "count",
      COUNT(*) FILTER (WHERE COALESCE(l."publishedAt",l."createdAt")>=NOW()-INTERVAL '30 days')::bigint AS "recent30"
    FROM "Listing" l JOIN root_map r ON r."id"=l."categoryId"
    WHERE l."status"='PUBLISHED'
    GROUP BY r."rootSlug",r."rootName"
    ORDER BY COUNT(*) DESC,"recent30" DESC
    LIMIT 12`),
   prisma.$queryRawUnsafe<CityRow[]>(`SELECT l."city",COUNT(*)::bigint AS "count",
      COUNT(*) FILTER (WHERE COALESCE(l."publishedAt",l."createdAt")>=NOW()-INTERVAL '30 days')::bigint AS "recent30"
    FROM "Listing" l
    WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND BTRIM(l."city")<>''
    GROUP BY l."city"
    ORDER BY COUNT(*) DESC,"recent30" DESC,l."city" ASC
    LIMIT 12`),
  ]);
  const [indexHygiene]=await prisma.$queryRawUnsafe<Array<{indexableCategories:bigint;indexableCities:bigint;noindexCities:bigint;indexableLocalPages:bigint;noindexLocalPages:bigint}>>(`WITH RECURSIVE anc AS (
    SELECT c."id" AS "descendantId",c."id" AS "ancestorId" FROM "Category" c WHERE c."isActive"=TRUE
    UNION ALL
    SELECT anc."descendantId",p."id" FROM anc JOIN "Category" cur ON cur."id"=anc."ancestorId" JOIN "Category" p ON p."id"=cur."parentId" WHERE p."isActive"=TRUE
   ), category_stats AS (
    SELECT a."slug",COUNT(l."id") AS count FROM anc JOIN "Category" a ON a."id"=anc."ancestorId" JOIN "Listing" l ON l."categoryId"=anc."descendantId" AND l."status"='PUBLISHED' GROUP BY a."slug"
   ), city_stats AS (
    SELECT l."city",COUNT(*) AS count FROM "Listing" l WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND BTRIM(l."city")<>'' GROUP BY l."city"
   ), local_stats AS (
    SELECT a."slug",l."city",COUNT(l."id") AS count FROM anc JOIN "Category" a ON a."id"=anc."ancestorId" JOIN "Listing" l ON l."categoryId"=anc."descendantId" WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND BTRIM(l."city")<>'' GROUP BY a."slug",l."city"
   ) SELECT
    (SELECT COUNT(*) FROM category_stats WHERE count>=1)::bigint AS "indexableCategories",
    (SELECT COUNT(*) FROM city_stats WHERE count>=3)::bigint AS "indexableCities",
    (SELECT COUNT(*) FROM city_stats WHERE count<3)::bigint AS "noindexCities",
    (SELECT COUNT(*) FROM local_stats WHERE count>=3)::bigint AS "indexableLocalPages",
    (SELECT COUNT(*) FROM local_stats WHERE count<3)::bigint AS "noindexLocalPages"`);
  const issues={missingTitle,missingDescription,missingSlug,missingMedia:Number(missingMedia[0]?.count??0)};
  const issueTotal=Object.values(issues).reduce((a,b)=>a+Number(b),0);
  const local=localRows.map(row=>{
    const count=Number(row.count),recent30=Number(row.recent30),priced=Number(row.priced),withMedia=Number(row.withMedia);
    return {categorySlug:row.categorySlug,categoryName:row.categoryName,city:row.city,count,recent30,priceCoveragePct:count?Math.round(priced/count*100):0,mediaCoveragePct:count?Math.round(withMedia/count*100):0,avgDescriptionChars:Number(row.avgDescriptionChars??0),href:`https://petitannonces.fr/c/${encodeURIComponent(row.categorySlug)}/${slugify(row.city)}`};
  });
  const livePages=local.filter(row=>row.count>=3).slice(0,16);
  const nearThreshold=local.filter(row=>row.count===2).sort((a,b)=>b.recent30-a.recent30||b.mediaCoveragePct-a.mediaCoveragePct||a.categoryName.localeCompare(b.categoryName,"fr")).slice(0,16);
  const oneListing=local.filter(row=>row.count===1).sort((a,b)=>b.recent30-a.recent30||b.mediaCoveragePct-a.mediaCoveragePct).slice(0,8);
  const recommendedActions=[
    ...(nearThreshold.length?[{code:"UNLOCK_LOCAL",title:`${nearThreshold.length} landing page${nearThreshold.length>1?"s":""} à 1 annonce du seuil`,detail:"Ajouter une annonce pertinente dans ces couples catégorie × ville suffit pour atteindre le seuil indexable de 3.",priority:"HIGH" as const}]:[]),
    ...(livePages.some(x=>x.mediaCoveragePct<90)?[{code:"MEDIA_QUALITY",title:"Renforcer les visuels des pages locales",detail:"Certaines landing pages indexables ont moins de 90 % d’annonces avec photo.",priority:"MEDIUM" as const}]:[]),
    ...(livePages.some(x=>x.avgDescriptionChars<120)?[{code:"CONTENT_DEPTH",title:"Améliorer la profondeur des descriptions",detail:"Certaines zones fortes ont des descriptions moyennes courtes; enrichir les annonces améliore la qualité globale de la page.",priority:"MEDIUM" as const}]:[]),
  ].slice(0,4);
  return reply.send({
    generatedAt:new Date().toISOString(),
    inventory:{publishedListings:published,activeCategories:categories,activeStores:stores,localLandingPairs:Number(localPairs[0]?.count??0),indexableLocalPages:Number(indexHygiene?.indexableLocalPages??0)},
    indexHygiene:{indexableCategories:Number(indexHygiene?.indexableCategories??0),indexableCities:Number(indexHygiene?.indexableCities??0),noindexCities:Number(indexHygiene?.noindexCities??0),indexableLocalPages:Number(indexHygiene?.indexableLocalPages??0),noindexLocalPages:Number(indexHygiene?.noindexLocalPages??0)},
    issues:{...issues,total:issueTotal},
    opportunities:{livePages,nearThreshold,oneListing,categories:categoryDensity.map(x=>({slug:x.slug,name:x.name,count:Number(x.count),recent30:Number(x.recent30)})),cities:cityDensity.map(x=>({city:x.city,count:Number(x.count),recent30:Number(x.recent30),href:`https://petitannonces.fr/ville/${slugify(x.city)}`})),recommendedActions},
    gsc:await snapshot(),
    gscLive:await getGscSummary(28),
    endpoints:{sitemap:"https://petitannonces.fr/sitemap.xml",robots:"https://petitannonces.fr/robots.txt"},
  })
 })
}