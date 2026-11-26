import {prisma} from "@pa/database";
import type {FastifyInstance} from "fastify";
import {requireAdminRoles} from "./rbac.js";
export async function registerAdminInspectionRoutes(app:FastifyInstance){
 app.get("/admin/inspection/overview",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MODERATOR","COMPLIANCE"])},async(_request,reply)=>{
  const [coverage,duplicates,sharedImages,risks,alerts]=await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SET LOCAL statement_timeout='8000ms'`;
   return Promise.all([
    tx.$queryRaw<Array<{active:number;scanned:number}>>`SELECT COUNT(*)::int AS active,LEAST(COUNT(*),5000)::int AS scanned FROM "Listing" WHERE "status" IN ('PENDING','PUBLISHED')`,
    tx.$queryRaw<Array<Record<string,unknown>>>`WITH recent AS MATERIALIZED (SELECT "id","sellerId","title","categoryId","priceMinor","currency","status","createdAt",lower(trim(regexp_replace(COALESCE("title",''),'[[:space:]]+',' ','g'))) AS normalized FROM "Listing" WHERE "status" IN ('PENDING','PUBLISHED') ORDER BY "createdAt" DESC,"id" LIMIT 5000),
    groups AS (SELECT "sellerId","categoryId","priceMinor","currency",normalized,COUNT(*)::int AS count FROM recent WHERE length(normalized)>=8 GROUP BY "sellerId","categoryId","priceMinor","currency",normalized HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC,"sellerId",normalized LIMIT 100)
    SELECT g."sellerId",g.normalized AS title,g.count,g."priceMinor",g.currency,(SELECT jsonb_agg(x) FROM (SELECT r.id,r.title,r.status::text AS status,r."createdAt" FROM recent r WHERE r."sellerId"=g."sellerId" AND r."categoryId"=g."categoryId" AND r."priceMinor" IS NOT DISTINCT FROM g."priceMinor" AND r.currency=g.currency AND r.normalized=g.normalized ORDER BY r."createdAt" DESC LIMIT 10) x) AS listings FROM groups g`,
    tx.$queryRaw<Array<Record<string,unknown>>>`WITH recent AS MATERIALIZED (SELECT "id","sellerId","title","status","createdAt" FROM "Listing" WHERE "status" IN ('PENDING','PUBLISHED') ORDER BY "createdAt" DESC,"id" LIMIT 5000),
    matches AS (SELECT m."objectKey",COUNT(DISTINCT r.id)::int AS count,COUNT(DISTINCT r."sellerId")::int AS sellers FROM recent r JOIN "ListingMedia" m ON m."listingId"=r.id WHERE m."status"='READY' AND m."objectKey"<>'' GROUP BY m."objectKey" HAVING COUNT(DISTINCT r.id)>1 ORDER BY COUNT(DISTINCT r.id) DESC,m."objectKey" LIMIT 100)
    SELECT m.count,m.sellers,(SELECT jsonb_agg(x) FROM (SELECT DISTINCT r.id,r.title,r.status::text AS status,r."sellerId" FROM recent r JOIN "ListingMedia" lm ON lm."listingId"=r.id WHERE lm."objectKey"=m."objectKey" AND lm."status"='READY' ORDER BY r.id LIMIT 10) x) AS listings FROM matches m`,
    tx.$queryRaw<Array<Record<string,unknown>>>`SELECT p."userId",u."status"::text AS status,u."email",p.score,p.level::text AS level,p."reviewRequired",p."assessedAt",p.signals FROM "UserRiskProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."status"='ACTIVE' AND (p."reviewRequired" OR p.level IN ('HIGH','CRITICAL')) ORDER BY p.score DESC,p."assessedAt" DESC LIMIT 100`,
    tx.$queryRaw<Array<{pendingOld:number;openReports:number;supportOld:number;failedEmails:number;highRiskAccounts:number}>>`SELECT (SELECT COUNT(*)::int FROM "Listing" l WHERE l."status"='PENDING' AND l."updatedAt"<CURRENT_TIMESTAMP-INTERVAL '24 hours') AS "pendingOld",(SELECT COUNT(*)::int FROM "TrustReport" WHERE "status" NOT IN ('DISMISSED','CLOSED')) AS "openReports",(SELECT COUNT(*)::int FROM "SupportTicket" WHERE "status"='PENDING_INTERNAL' AND "lastMessageAt"<CURRENT_TIMESTAMP-INTERVAL '24 hours') AS "supportOld",(SELECT COUNT(*)::int FROM "NotificationDeliveryOutbox" WHERE "channel"='EMAIL' AND "status"='FAILED' AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours') AS "failedEmails",(SELECT COUNT(*)::int FROM "UserRiskProfile" p JOIN "User" u ON u.id=p."userId" WHERE u."status"='ACTIVE' AND p.level IN ('HIGH','CRITICAL')) AS "highRiskAccounts"`
   ]);
  },{timeout:15000});
  return reply.send({coverage:coverage[0],duplicates,sharedImages,risks,alerts:alerts[0],generatedAt:new Date().toISOString(),groupLimit:100,memberLimit:10});
 });
}
