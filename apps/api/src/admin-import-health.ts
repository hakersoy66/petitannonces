import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ensureImportLogTable } from "./import-log.js";
import { requireAdminRoles } from "./rbac.js";

const ROLES=["SUPER_ADMIN","ADMIN","MARKETING","MODERATOR","SUPPORT"] as const;

function sourceLabel(source:string){return ({LEBONCOIN:"Leboncoin",VINTED:"Vinted",FACEBOOK_MARKETPLACE:"Facebook Marketplace (historique)",LINK:"Lien externe",BULK:"Import en masse",CSV:"CSV",JSON_FEED:"Flux JSON",XML_FEED:"Flux XML"} as Record<string,string>)[source]??source;}
function quality(row:{title:string|null;description:string|null;priceMinor:number|null;city:string|null;postalCode:string|null;mediaCount:number}){
  let score=0;const issues:string[]=[];
  if((row.title??"").trim().length>=10)score+=20;else issues.push("Titre trop court");
  if((row.description??"").trim().length>=80)score+=25;else issues.push("Description courte");
  if(row.priceMinor!==null)score+=20;else issues.push("Prix manquant");
  if((row.city??"").trim()&&(row.postalCode??"").trim())score+=15;else issues.push("Localisation incomplète");
  if(row.mediaCount>=3)score+=20;else if(row.mediaCount>=1){score+=10;issues.push("Moins de 3 photos");}else issues.push("Aucune photo");
  return{score,issues};
}

export async function registerAdminImportHealthRoutes(app:FastifyInstance){
  await ensureImportLogTable();
  app.get("/admin/import-health",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{
    const parsed=z.object({days:z.coerce.number().int().min(7).max(365).default(30)}).safeParse(request.query);
    if(!parsed.success)return reply.code(400).send({error:"invalid_period"});
    const days=parsed.data.days;
    const [summaryRows,sources,statuses,categories,daily,recent]=await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(`
        SELECT COUNT(*)::int AS total,
          (SELECT COUNT(*)::int FROM "ListingImportLog" x WHERE x."createdAt">=CURRENT_DATE-($1::int-1)) AS "loggedTotal",
          (SELECT COUNT(*)::int FROM "ListingImportLog" x LEFT JOIN "Listing" lx ON lx."id"=x."listingId" WHERE x."createdAt">=CURRENT_DATE-($1::int-1) AND lx."id" IS NULL) AS "removedListings",
          COUNT(*) FILTER (WHERE i."sourceType"='LEBONCOIN')::int AS leboncoin,
          COUNT(DISTINCT i."userId")::int AS "uniqueUsers",
          COUNT(*) FILTER (WHERE l."publishedAt" IS NOT NULL)::int AS published,
          COUNT(*) FILTER (WHERE l."city" IS NOT NULL AND btrim(l."city")<>'' AND l."postalCode" IS NOT NULL AND btrim(l."postalCode")<>'')::int AS "completeLocation",
          COUNT(*) FILTER (WHERE l."description" IS NOT NULL AND length(btrim(l."description"))>=80)::int AS "goodDescription",
          COUNT(*) FILTER (WHERE l."title" IS NOT NULL AND length(btrim(l."title"))>=10)::int AS "goodTitle",
          COUNT(*) FILTER (WHERE l."priceMinor" IS NOT NULL)::int AS "withPrice",
          COUNT(*) FILTER (WHERE COALESCE(m.cnt,0)>0)::int AS "withPhotos",
          COUNT(*) FILTER (WHERE COALESCE(m.cnt,0)>=3)::int AS "goodPhotos",
          ROUND(COALESCE(AVG(COALESCE(m.cnt,0)),0)::numeric,2)::float AS "avgPhotos"
        FROM "ListingImportLog" i
        JOIN "Listing" l ON l."id"=i."listingId"
        LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY') m ON TRUE
        WHERE i."createdAt">=CURRENT_DATE-($1::int-1)`,days),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT i."sourceType" AS source,COUNT(*)::int AS total,COUNT(*) FILTER(WHERE l."publishedAt" IS NOT NULL)::int AS published,ROUND(COALESCE(AVG(COALESCE(m.cnt,0)),0)::numeric,2)::float AS "avgPhotos" FROM "ListingImportLog" i JOIN "Listing" l ON l."id"=i."listingId" LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY') m ON TRUE WHERE i."createdAt">=CURRENT_DATE-($1::int-1) GROUP BY i."sourceType" ORDER BY total DESC`,days),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT l."status"::text AS status,COUNT(*)::int AS count FROM "ListingImportLog" i JOIN "Listing" l ON l."id"=i."listingId" WHERE i."createdAt">=CURRENT_DATE-($1::int-1) GROUP BY l."status" ORDER BY count DESC`,days),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT c."name",c."slug",COUNT(*)::int AS count,COUNT(*) FILTER(WHERE l."publishedAt" IS NOT NULL)::int AS published FROM "ListingImportLog" i JOIN "Listing" l ON l."id"=i."listingId" JOIN "Category" c ON c."id"=l."categoryId" WHERE i."createdAt">=CURRENT_DATE-($1::int-1) GROUP BY c."id",c."name",c."slug" ORDER BY count DESC LIMIT 12`,days),
      prisma.$queryRawUnsafe<Array<any>>(`WITH d AS (SELECT generate_series(CURRENT_DATE-($1::int-1),CURRENT_DATE,'1 day'::interval)::date AS day) SELECT d.day,COUNT(i."id")::int AS imports,COUNT(i."id") FILTER(WHERE i."sourceType"='LEBONCOIN')::int AS leboncoin,COUNT(i."id") FILTER(WHERE l."publishedAt" IS NOT NULL)::int AS published FROM d LEFT JOIN "ListingImportLog" i ON i."createdAt"::date=d.day LEFT JOIN "Listing" l ON l."id"=i."listingId" GROUP BY d.day ORDER BY d.day`,days),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT i."id",i."listingId",i."sourceType",i."sourceUrl",i."createdAt",l."title",l."description",l."priceMinor",l."city",l."postalCode",l."status"::text,l."slug",l."publishedAt",c."name" AS "categoryName",c."slug" AS "categorySlug",u."email" AS "sellerEmail",COALESCE(p."displayName",p."firstName",u."email") AS "sellerName",COALESCE(m.cnt,0)::int AS "mediaCount" FROM "ListingImportLog" i JOIN "Listing" l ON l."id"=i."listingId" JOIN "Category" c ON c."id"=l."categoryId" JOIN "User" u ON u."id"=i."userId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY') m ON TRUE WHERE i."createdAt">=CURRENT_DATE-($1::int-1) ORDER BY i."createdAt" DESC LIMIT 80`,days),
    ]);
    const s=summaryRows[0]??{};
    const recentRows=recent.map((r:any)=>{const q=quality({title:r.title,description:r.description,priceMinor:r.priceMinor===null?null:Number(r.priceMinor),city:r.city,postalCode:r.postalCode,mediaCount:Number(r.mediaCount??0)});return{id:String(r.id),listingId:String(r.listingId),source:String(r.sourceType),sourceLabel:sourceLabel(String(r.sourceType)),sourceUrl:r.sourceUrl?String(r.sourceUrl):null,createdAt:r.createdAt instanceof Date?r.createdAt.toISOString():String(r.createdAt),title:r.title?String(r.title):null,city:r.city?String(r.city):null,postalCode:r.postalCode?String(r.postalCode):null,status:String(r.status),slug:r.slug?String(r.slug):null,publishedAt:r.publishedAt instanceof Date?r.publishedAt.toISOString():r.publishedAt?String(r.publishedAt):null,category:{name:String(r.categoryName),slug:String(r.categorySlug)},seller:{name:String(r.sellerName),email:String(r.sellerEmail)},mediaCount:Number(r.mediaCount??0),qualityScore:q.score,qualityIssues:q.issues};});
    const lowQuality=recentRows.filter(r=>r.qualityScore<70).length;
    return reply.send({days,summary:{total:Number(s.total??0),loggedTotal:Number(s.loggedTotal??s.total??0),removedListings:Number(s.removedListings??0),leboncoin:Number(s.leboncoin??0),uniqueUsers:Number(s.uniqueUsers??0),published:Number(s.published??0),completeLocation:Number(s.completeLocation??0),goodDescription:Number(s.goodDescription??0),goodTitle:Number(s.goodTitle??0),withPrice:Number(s.withPrice??0),withPhotos:Number(s.withPhotos??0),goodPhotos:Number(s.goodPhotos??0),avgPhotos:Number(s.avgPhotos??0),lowQualityRecent:lowQuality},sources:sources.map((r:any)=>({source:String(r.source),label:sourceLabel(String(r.source)),total:Number(r.total??0),published:Number(r.published??0),avgPhotos:Number(r.avgPhotos??0)})),statuses:statuses.map((r:any)=>({status:String(r.status),count:Number(r.count??0)})),categories:categories.map((r:any)=>({name:String(r.name),slug:String(r.slug),count:Number(r.count??0),published:Number(r.published??0)})),daily:daily.map((r:any)=>({day:r.day instanceof Date?r.day.toISOString().slice(0,10):String(r.day).slice(0,10),imports:Number(r.imports??0),leboncoin:Number(r.leboncoin??0),published:Number(r.published??0)})),recent:recentRows});
  });
}