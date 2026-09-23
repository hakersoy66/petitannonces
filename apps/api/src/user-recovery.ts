import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { deliverUserEvent } from "./notification-delivery.js";
import { requireAdminRoles } from "./rbac.js";
import { runObservedJob } from "./job-observability.js";
import { evaluateListing } from "./publication.js";

const FIRST_DRAFT_DELAY_MINUTES=90;
const SECOND_DRAFT_DELAY_HOURS=24;
const WORKER_INTERVAL_MS=15*60_000;
const ADMIN_ROLES=["SUPER_ADMIN","ADMIN","SUPPORT","MARKETING","MODERATOR"] as const;

type DraftRow={
 id:string;sellerId:string;title:string|null;updatedAt:Date;draftSavedAt:Date|null;email:string;name:string;
};

export async function ensureUserRecoverySchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DraftRecoveryReminder" (
  "id" TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "stage" TEXT NOT NULL,
  "queuedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("listingId","stage")
 )`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DraftRecoveryReminder_user_created_idx" ON "DraftRecoveryReminder"("userId","createdAt" DESC)`);
}

async function claim(listingId:string,userId:string,stage:"90M"|"24H"){
 const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(
  `INSERT INTO "DraftRecoveryReminder" ("id","listingId","userId","stage") VALUES ($1,$2,$3,$4) ON CONFLICT ("listingId","stage") DO NOTHING RETURNING "id"`,
  randomUUID(),listingId,userId,stage,
 );
 return rows[0]?.id??null;
}

async function refreshDraftQualitySnapshots(limit=30){
 const rows=await prisma.$queryRawUnsafe<Array<{id:string;sellerId:string}>>(`
  SELECT l."id",l."sellerId" FROM "Listing" l
  JOIN "User" uq ON uq."id"=l."sellerId" AND uq."status"='ACTIVE'
  LEFT JOIN "ListingQualitySnapshot" q ON q."listingId"=l."id"
  WHERE l."status"='DRAFT'
   AND NOT EXISTS(SELECT 1 FROM "ListingSpamHold" sh WHERE sh."userId"=l."sellerId" AND sh."status" IN ('PENDING','REJECTED'))
   AND l."updatedAt">CURRENT_TIMESTAMP-INTERVAL '30 days'
   AND l."updatedAt"<=CURRENT_TIMESTAMP-INTERVAL '30 minutes'
   AND (COALESCE(length(BTRIM(l."title")),0)>=5 OR COALESCE(length(BTRIM(l."description")),0)>=20 OR EXISTS(SELECT 1 FROM "ListingMedia" lm WHERE lm."listingId"=l."id"))
   AND (q."listingId" IS NULL OR q."assessedAt"<l."updatedAt")
  ORDER BY l."updatedAt" DESC LIMIT $1`,limit);
 let refreshed=0;
 for(const row of rows){
  try{
   const result=await evaluateListing(row.id,row.sellerId);if(!result)continue;
   await prisma.$executeRawUnsafe(`INSERT INTO "ListingQualitySnapshot" ("listingId","sellerId","score","level","issues","assessedAt") VALUES ($1,$2,$3,$4,$5::jsonb,CURRENT_TIMESTAMP) ON CONFLICT ("listingId") DO UPDATE SET "sellerId"=EXCLUDED."sellerId","score"=EXCLUDED."score","level"=EXCLUDED."level","issues"=EXCLUDED."issues","assessedAt"=CURRENT_TIMESTAMP`,row.id,row.sellerId,result.quality.score,result.quality.level,JSON.stringify(result.quality.issues));
   refreshed++;
  }catch{}
 }
 return refreshed;
}

async function queueDraftReminder(row:DraftRow,stage:"90M"|"24H"){
 const reminderId=await claim(row.id,row.sellerId,stage);if(!reminderId)return false;
 const title=stage==="90M"?"Votre annonce vous attend":"Souhaitez-vous terminer votre annonce ?";
 const listingTitle=row.title?.trim()||"votre annonce";
 const body=stage==="90M"
  ?`Vous avez commencé « ${listingTitle} » sans terminer la publication. Votre progression a été conservée pour que vous puissiez reprendre là où vous vous êtes arrêté.`
  :`Votre brouillon « ${listingTitle} » est toujours disponible. Quelques minutes peuvent suffire pour compléter les informations manquantes et publier l’annonce.`;
 try{
  await deliverUserEvent({
   userId:row.sellerId,eventKind:"LISTING",notificationKind:"LISTING",title,body,
   actionUrl:`/deposer-une-annonce?listingId=${encodeURIComponent(row.id)}`,
   dedupeKey:`draft-recovery:${row.id}:${stage.toLowerCase()}`,
   metadata:{source:"DRAFT_RECOVERY",listingId:row.id,stage},
  });
  await prisma.$executeRawUnsafe(`UPDATE "DraftRecoveryReminder" SET "queuedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,reminderId);
  return true;
 }catch(error){
  await prisma.$executeRawUnsafe(`DELETE FROM "DraftRecoveryReminder" WHERE "id"=$1`,reminderId).catch(()=>undefined);
  throw error;
 }
}

export async function runDraftRecoverySweep(){
 await ensureUserRecoverySchema();
 return runObservedJob("draft-recovery-sweep",async()=>{
  const qualityRefreshed=await refreshDraftQualitySnapshots().catch(()=>0);
  const first=await prisma.$queryRawUnsafe<DraftRow[]>(`
   SELECT l."id",l."sellerId",l."title",l."updatedAt",l."draftSavedAt",u."email",
    COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name"
   FROM "Listing" l
   JOIN "User" u ON u."id"=l."sellerId" AND u."status"='ACTIVE'
   LEFT JOIN "UserProfile" p ON p."userId"=u."id"
   WHERE l."status"='DRAFT'
    AND l."updatedAt"<=CURRENT_TIMESTAMP-INTERVAL '${FIRST_DRAFT_DELAY_MINUTES} minutes'
    AND l."updatedAt">CURRENT_TIMESTAMP-INTERVAL '14 days'
    AND (COALESCE(length(BTRIM(l."title")),0)>=5 OR COALESCE(length(BTRIM(l."description")),0)>=20 OR EXISTS(SELECT 1 FROM "ListingMedia" lm WHERE lm."listingId"=l."id"))
    AND NOT EXISTS(SELECT 1 FROM "DraftRecoveryReminder" r WHERE r."listingId"=l."id" AND r."stage"='90M')
   ORDER BY l."updatedAt" ASC LIMIT 80`);
  let firstQueued=0,secondQueued=0,failed=0;
  for(const row of first){
   try{
    if(await queueDraftReminder(row,"90M")){
      firstQueued++;
      if(!row.draftSavedAt)await prisma.$executeRawUnsafe(`UPDATE "Listing" SET "draftSavedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='DRAFT' AND "draftSavedAt" IS NULL`,row.id);
    }
   }catch{failed++}
  }
  const second=await prisma.$queryRawUnsafe<DraftRow[]>(`
   SELECT l."id",l."sellerId",l."title",l."updatedAt",l."draftSavedAt",u."email",
    COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name"
   FROM "Listing" l
   JOIN "User" u ON u."id"=l."sellerId" AND u."status"='ACTIVE'
   LEFT JOIN "UserProfile" p ON p."userId"=u."id"
   WHERE l."status"='DRAFT' AND l."draftSavedAt" IS NOT NULL
    AND l."updatedAt"<=CURRENT_TIMESTAMP-INTERVAL '${SECOND_DRAFT_DELAY_HOURS} hours'
    AND l."updatedAt">CURRENT_TIMESTAMP-INTERVAL '30 days'
    AND EXISTS(SELECT 1 FROM "DraftRecoveryReminder" r WHERE r."listingId"=l."id" AND r."stage"='90M' AND r."queuedAt"<=CURRENT_TIMESTAMP-INTERVAL '24 hours')
    AND NOT EXISTS(SELECT 1 FROM "DraftRecoveryReminder" r WHERE r."listingId"=l."id" AND r."stage"='24H')
   ORDER BY l."updatedAt" ASC LIMIT 80`);
  for(const row of second){try{if(await queueDraftReminder(row,"24H"))secondQueued++}catch{failed++}}
  return{qualityRefreshed,firstCandidates:first.length,secondCandidates:second.length,firstQueued,secondQueued,failed};
 });
}

export async function registerUserRecoveryRoutes(app:FastifyInstance){
 await ensureUserRecoverySchema();
 app.get("/admin/user-attention",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(_request,reply)=>{
  const [technical,drafts,checkouts,quality,recoverySummary]=await Promise.all([
   prisma.$queryRawUnsafe<Array<any>>(`
    SELECT e."userId",u."email",COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name",
      e."event",COUNT(*)::int AS "count",MAX(e."createdAt") AS "lastAt",MAX(e."path") AS "path"
    FROM "SiteAnalyticsEvent" e
    JOIN "User" u ON u."id"=e."userId" AND u."status"='ACTIVE'
    LEFT JOIN "UserProfile" p ON p."userId"=u."id"
    WHERE e."userId" IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM "ListingSpamHold" sh WHERE sh."userId"=e."userId" AND sh."status" IN ('PENDING','REJECTED')) AND e."createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours'
      AND e."event" IN ('PHOTO_UPLOAD_FAILED','LISTING_PUBLISH_FAILED','CHECKOUT_FAILED')
    GROUP BY e."userId",u."email",p."displayName",p."firstName",p."lastName",e."event"
    HAVING COUNT(*)>=2
    ORDER BY COUNT(*) DESC,MAX(e."createdAt") DESC LIMIT 30`),
   prisma.$queryRawUnsafe<Array<any>>(`
    SELECT l."id" AS "listingId",l."sellerId" AS "userId",l."title",l."updatedAt",l."draftSavedAt",u."email",
      COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name",
      EXISTS(SELECT 1 FROM "DraftRecoveryReminder" r WHERE r."listingId"=l."id" AND r."stage"='90M' AND r."queuedAt" IS NOT NULL) AS "reminded"
    FROM "Listing" l JOIN "User" u ON u."id"=l."sellerId" AND u."status"='ACTIVE'
    LEFT JOIN "UserProfile" p ON p."userId"=u."id"
    WHERE l."status"='DRAFT'
      AND NOT EXISTS(SELECT 1 FROM "ListingSpamHold" sh WHERE sh."userId"=l."sellerId" AND sh."status" IN ('PENDING','REJECTED')) AND l."updatedAt"<=CURRENT_TIMESTAMP-INTERVAL '${FIRST_DRAFT_DELAY_MINUTES} minutes'
      AND l."updatedAt">CURRENT_TIMESTAMP-INTERVAL '14 days'
      AND (COALESCE(length(BTRIM(l."title")),0)>=5 OR COALESCE(length(BTRIM(l."description")),0)>=20 OR EXISTS(SELECT 1 FROM "ListingMedia" lm WHERE lm."listingId"=l."id"))
    ORDER BY l."updatedAt" DESC LIMIT 30`),
   prisma.$queryRawUnsafe<Array<any>>(`
    SELECT o."id" AS "orderId",o."buyerId" AS "userId",o."orderNumber",o."createdAt",o."totalAmountMinor",o."currency",
      l."title",u."email",COALESCE(pf."displayName",NULLIF(TRIM(CONCAT_WS(' ',pf."firstName",pf."lastName")),''),u."email") AS "name"
    FROM "MarketplaceOrder" o JOIN "Listing" l ON l."id"=o."listingId" JOIN "User" u ON u."id"=o."buyerId" AND u."status"='ACTIVE'
    LEFT JOIN "UserProfile" pf ON pf."userId"=u."id"
    WHERE o."status"='PENDING_PAYMENT'
      AND NOT EXISTS(SELECT 1 FROM "ListingSpamHold" sh WHERE sh."userId"=o."buyerId" AND sh."status" IN ('PENDING','REJECTED')) AND o."createdAt"<=CURRENT_TIMESTAMP-INTERVAL '30 minutes'
      AND NOT EXISTS(SELECT 1 FROM "MarketplacePayment" mp WHERE mp."orderId"=o."id" AND mp."status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))
    ORDER BY o."createdAt" DESC LIMIT 30`),
   prisma.$queryRawUnsafe<Array<any>>(`
    SELECT q."listingId",q."sellerId" AS "userId",q."score",q."level",q."issues",q."assessedAt",l."title",u."email",
      COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name"
    FROM "ListingQualitySnapshot" q JOIN "Listing" l ON l."id"=q."listingId" JOIN "User" u ON u."id"=q."sellerId" AND u."status"='ACTIVE'
    LEFT JOIN "UserProfile" p ON p."userId"=u."id"
    WHERE l."status"='DRAFT'
      AND NOT EXISTS(SELECT 1 FROM "ListingSpamHold" sh WHERE sh."userId"=q."sellerId" AND sh."status" IN ('PENDING','REJECTED')) AND l."updatedAt"<=CURRENT_TIMESTAMP-INTERVAL '30 minutes' AND q."score"<70 AND q."assessedAt">=l."updatedAt" AND q."assessedAt">=CURRENT_TIMESTAMP-INTERVAL '30 days'
    ORDER BY q."score" ASC,q."assessedAt" DESC LIMIT 30`),
   prisma.$queryRawUnsafe<Array<any>>(`
    SELECT COUNT(*) FILTER(WHERE "stage"='90M' AND "queuedAt" IS NOT NULL)::int AS "firstReminders",
      COUNT(*) FILTER(WHERE "stage"='24H' AND "queuedAt" IS NOT NULL)::int AS "secondReminders"
    FROM "DraftRecoveryReminder" WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days'`),
  ]);
  const eventLabels:Record<string,string>={
   PHOTO_UPLOAD_FAILED:"Échecs d’envoi de photos",
   LISTING_PUBLISH_FAILED:"Échecs de publication",
   CHECKOUT_FAILED:"Échecs de préparation du paiement",
  };
  return reply.send({
   config:{draftFirstDelayMinutes:FIRST_DRAFT_DELAY_MINUTES,draftSecondDelayHours:SECOND_DRAFT_DELAY_HOURS},
   summary:{technicalAlerts:technical.length,abandonedDrafts:drafts.length,abandonedCheckouts:checkouts.length,lowQualityDrafts:quality.length,firstDraftReminders:Number(recoverySummary[0]?.firstReminders??0),secondDraftReminders:Number(recoverySummary[0]?.secondReminders??0)},
   technical:technical.map(row=>({...row,label:eventLabels[String(row.event)]??String(row.event),count:Number(row.count??0)})),
   drafts,
   checkouts:checkouts.map(row=>({...row,totalAmountMinor:Number(row.totalAmountMinor??0)})),
   quality:quality.map(row=>({...row,score:Number(row.score??0)})),
  });
 });
 app.post("/admin/user-attention/run-draft-recovery",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MARKETING"])},async(_request,reply)=>reply.send(await runDraftRecoverySweep()));
}

export function startDraftRecoveryWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{const result=await runDraftRecoverySweep();if(Number((result as any)?.firstQueued??0)+Number((result as any)?.secondQueued??0)>0)log?.info(result,"draft recovery sweep processed")}catch(error){log?.error(error,"draft recovery sweep failed")}finally{running=false}};
 const first=setTimeout(()=>void tick(),90_000);first.unref();
 const timer=setInterval(()=>void tick(),WORKER_INTERVAL_MS);timer.unref();return timer;
}