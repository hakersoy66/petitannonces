import { prisma } from "@pa/database";
import { deliverUserEvent } from "./notification-delivery.js";
import { notifyListingIndexNow } from "./indexnow.js";

export const LISTING_LIFETIME_DAYS = 30;
export const LISTING_RENEWAL_COST_MINOR = 99;
export const LISTING_RENEWAL_CURRENCY = "EUR";
const LIFETIME_MS = LISTING_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ListingLifecycleRow = { listingId:string; expiresAt:Date; freeRenewalUsed:boolean; renewalCount:number; lastRenewedAt:Date|null };
type ExpiryEventRow = { listingId:string; sellerId:string; title:string|null; expiresAt:Date; freeRenewalUsed:boolean };

export async function ensureListingLifecycleSchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingLifecycle" ("listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,"expiresAt" TIMESTAMPTZ NOT NULL,"freeRenewalUsed" BOOLEAN NOT NULL DEFAULT FALSE,"renewalCount" INTEGER NOT NULL DEFAULT 0,"lastRenewedAt" TIMESTAMPTZ,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingLifecycle_expiresAt_idx" ON "ListingLifecycle"("expiresAt")`);
 await prisma.$executeRawUnsafe(`INSERT INTO "ListingLifecycle" ("listingId","expiresAt") SELECT l."id",COALESCE(l."publishedAt",l."createdAt")+INTERVAL '30 days' FROM "Listing" l WHERE l."status"='PUBLISHED' AND NOT EXISTS(SELECT 1 FROM "ListingLifecycle" lc WHERE lc."listingId"=l."id") ON CONFLICT ("listingId") DO NOTHING`);
}

export function listingExpiryFrom(base=new Date()){return new Date(base.getTime()+LIFETIME_MS)}
export async function activateListingLifetime(listingId:string,base=new Date(),resetExisting=false){const expiresAt=listingExpiryFrom(base);if(resetExisting)await prisma.$executeRawUnsafe(`INSERT INTO "ListingLifecycle" ("listingId","expiresAt") VALUES ($1,$2) ON CONFLICT ("listingId") DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt","updatedAt"=CURRENT_TIMESTAMP`,listingId,expiresAt);else await prisma.$executeRawUnsafe(`INSERT INTO "ListingLifecycle" ("listingId","expiresAt") VALUES ($1,$2) ON CONFLICT ("listingId") DO NOTHING`,listingId,expiresAt);const rows=await prisma.$queryRawUnsafe<Array<{expiresAt:Date}>>(`SELECT "expiresAt" FROM "ListingLifecycle" WHERE "listingId"=$1 LIMIT 1`,listingId);return rows[0]?.expiresAt??expiresAt}
export async function getListingLifecycles(ids:string[]){if(!ids.length)return[] as ListingLifecycleRow[];return prisma.$queryRawUnsafe<ListingLifecycleRow[]>(`SELECT "listingId","expiresAt","freeRenewalUsed","renewalCount","lastRenewedAt" FROM "ListingLifecycle" WHERE "listingId"=ANY($1::text[])`,ids)}

function expiryCycleKey(row:ExpiryEventRow){return row.expiresAt.toISOString()}

export async function notifyUpcomingListingExpirations(limit=500){
 const rows=await prisma.$queryRawUnsafe<ExpiryEventRow[]>(`SELECT l."id" AS "listingId",l."sellerId",l."title",lc."expiresAt",lc."freeRenewalUsed" FROM "ListingLifecycle" lc JOIN "Listing" l ON l."id"=lc."listingId" WHERE l."status"='PUBLISHED' AND lc."expiresAt">CURRENT_TIMESTAMP AND lc."expiresAt"<=CURRENT_TIMESTAMP+INTERVAL '7 days' AND NOT EXISTS (SELECT 1 FROM "ProfessionalSubscription" ps JOIN "ProfessionalPlan" pp ON pp."id"=ps."planId" WHERE ps."userId"=l."sellerId" AND ps."status" IN ('TRIALING','ACTIVE') AND pp."autoRenewListings"=TRUE AND pp."isActive"=TRUE AND (ps."currentPeriodEnd" IS NULL OR ps."currentPeriodEnd">CURRENT_TIMESTAMP) AND (ps."status"='ACTIVE' OR ps."trialEndsAt" IS NULL OR ps."trialEndsAt">CURRENT_TIMESTAMP)) ORDER BY lc."expiresAt" ASC LIMIT $1`,limit);
 const now=Date.now();let queued=0;
 for(const row of rows){
  const remaining=row.expiresAt.getTime()-now;
  const stage=remaining<=DAY_MS?"1d":remaining<=3*DAY_MS?"3d":"7d";
  const when=stage==="1d"?"dans moins de 24 heures":stage==="3d"?"dans moins de 3 jours":"dans moins de 7 jours";
  const body=row.freeRenewalUsed?`Votre annonce « ${row.title??"Sans titre"} » expire ${when}. Après expiration, une prolongation de 30 jours coûte 0,99 €.`:`Votre annonce « ${row.title??"Sans titre"} » expire ${when}. Votre première prolongation de 30 jours sera gratuite.`;
  await deliverUserEvent({userId:row.sellerId,eventKind:"LISTING",notificationKind:"LISTING",title:"Votre annonce arrive bientôt à expiration",body,actionUrl:"/mon-compte/annonces?status=PUBLISHED",metadata:{listingId:row.listingId,expiresAt:row.expiresAt.toISOString(),expiryStage:stage},dedupeKey:`listing-expiry-warning:${row.listingId}:${expiryCycleKey(row)}:${stage}`});
  queued++;
 }
 return queued;
}

export async function autoRenewProfessionalListings(limit=500){
 const rows=await prisma.$queryRawUnsafe<ExpiryEventRow[]>(`SELECT l."id" AS "listingId",l."sellerId",l."title",lc."expiresAt",lc."freeRenewalUsed" FROM "ListingLifecycle" lc JOIN "Listing" l ON l."id"=lc."listingId" WHERE l."status"='PUBLISHED' AND lc."expiresAt"<=CURRENT_TIMESTAMP AND EXISTS (SELECT 1 FROM "ProfessionalSubscription" ps JOIN "ProfessionalPlan" pp ON pp."id"=ps."planId" WHERE ps."userId"=l."sellerId" AND ps."status" IN ('TRIALING','ACTIVE') AND pp."autoRenewListings"=TRUE AND pp."isActive"=TRUE AND (ps."currentPeriodEnd" IS NULL OR ps."currentPeriodEnd">CURRENT_TIMESTAMP) AND (ps."status"='ACTIVE' OR ps."trialEndsAt" IS NULL OR ps."trialEndsAt">CURRENT_TIMESTAMP)) ORDER BY lc."expiresAt" ASC LIMIT $1`,limit);
 let renewed=0;
 for(const row of rows){
  const updated=await prisma.$queryRawUnsafe<Array<{expiresAt:Date}>>(`UPDATE "ListingLifecycle" SET "expiresAt"=GREATEST("expiresAt",CURRENT_TIMESTAMP)+INTERVAL '30 days',"renewalCount"="renewalCount"+1,"lastRenewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1 AND "expiresAt"=$2 AND "expiresAt"<=CURRENT_TIMESTAMP RETURNING "expiresAt"`,row.listingId,row.expiresAt);
  if(!updated[0])continue;
  await prisma.listing.updateMany({where:{id:row.listingId,status:"PUBLISHED"},data:{publishedAt:new Date(),updatedAt:new Date()}});
  await deliverUserEvent({userId:row.sellerId,eventKind:"LISTING",notificationKind:"LISTING",title:"Annonce renouvelée automatiquement",body:`Votre annonce « ${row.title??"Sans titre"} » a été prolongée automatiquement de 30 jours grâce à votre formule Petit Annonces Pro.`,actionUrl:"/mon-compte/annonces?status=PUBLISHED",metadata:{listingId:row.listingId,automaticRenewal:true,expiresAt:updated[0].expiresAt.toISOString()},dedupeKey:`listing-pro-auto-renew:${row.listingId}:${row.expiresAt.toISOString()}`});
  await notifyListingIndexNow(row.listingId).catch(()=>undefined);
  renewed++;
 }
 return renewed;
}

export async function expireDueListings(limit=500){
 const rows=await prisma.$queryRawUnsafe<ExpiryEventRow[]>(`WITH due AS (SELECT lc."listingId" FROM "ListingLifecycle" lc JOIN "Listing" l0 ON l0."id"=lc."listingId" WHERE l0."status"='PUBLISHED' AND lc."expiresAt"<=CURRENT_TIMESTAMP ORDER BY lc."expiresAt" ASC LIMIT $1) UPDATE "Listing" l SET "status"='EXPIRED',"updatedAt"=CURRENT_TIMESTAMP FROM "ListingLifecycle" lc,due WHERE l."id"=due."listingId" AND lc."listingId"=l."id" AND l."status"='PUBLISHED' RETURNING l."id" AS "listingId",l."sellerId",l."title",lc."expiresAt",lc."freeRenewalUsed"`,limit);
 for(const row of rows){
  const body=row.freeRenewalUsed?`Votre annonce « ${row.title??"Sans titre"} » a expiré. Vous pouvez la prolonger de 30 jours pour 0,99 €.`:`Votre annonce « ${row.title??"Sans titre"} » a expiré. Votre première prolongation de 30 jours est gratuite.`;
  await deliverUserEvent({userId:row.sellerId,eventKind:"LISTING",notificationKind:"LISTING",title:"Votre annonce a expiré",body,actionUrl:"/mon-compte/annonces?status=EXPIRED",metadata:{listingId:row.listingId,expiresAt:row.expiresAt.toISOString(),expired:true},dedupeKey:`listing-expired:${row.listingId}:${expiryCycleKey(row)}`});
  await notifyListingIndexNow(row.listingId,true).catch(()=>undefined);
 }
 return rows.length;
}

async function renewLocked(tx:any,listingId:string,userId:string,paid:boolean){
 const ls=await tx.$queryRawUnsafe(`SELECT "id","sellerId","status"::text FROM "Listing" WHERE "id"=$1 FOR UPDATE`,listingId) as Array<{id:string;sellerId:string;status:string}>;const l=ls[0];if(!l||l.sellerId!==userId)throw new Error("listing_not_found");
 const rs=await tx.$queryRawUnsafe(`SELECT "listingId","expiresAt","freeRenewalUsed","renewalCount","lastRenewedAt" FROM "ListingLifecycle" WHERE "listingId"=$1 FOR UPDATE`,listingId) as ListingLifecycleRow[];let lc=rs[0];if(!lc)throw new Error("listing_lifecycle_not_found");if(!["EXPIRED","DRAFT"].includes(l.status)||lc.expiresAt.getTime()>Date.now())throw new Error("listing_not_expired");
 if(!paid&&lc.freeRenewalUsed)throw new Error("listing_renewal_payment_required");if(paid&&!lc.freeRenewalUsed)throw new Error("free_renewal_available");
 const now=new Date(),expiresAt=listingExpiryFrom(now);await tx.$executeRawUnsafe(`UPDATE "ListingLifecycle" SET "expiresAt"=$2,"freeRenewalUsed"=TRUE,"renewalCount"="renewalCount"+1,"lastRenewedAt"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1`,listingId,expiresAt,now);const nextStatus=l.status==="DRAFT"?"DRAFT":"PUBLISHED";await tx.$executeRawUnsafe(`UPDATE "Listing" SET "status"=$2::"ListingStatus","publishedAt"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,listingId,nextStatus,now);return{listingId,expiresAt,status:nextStatus,requiresReview:nextStatus==="DRAFT",chargedMinor:paid?LISTING_RENEWAL_COST_MINOR:0,currency:LISTING_RENEWAL_CURRENCY,freeRenewalUsed:true,renewalCount:lc.renewalCount+1}
}

export async function renewExpiredListing(listingId:string,userId:string){const result=await prisma.$transaction((tx:any)=>renewLocked(tx,listingId,userId,false));if(result.status==="PUBLISHED")await notifyListingIndexNow(result.listingId).catch(()=>undefined);return result}
export async function completePaidListingRenewal(listingId:string,userId:string){const result=await prisma.$transaction((tx:any)=>renewLocked(tx,listingId,userId,true));if(result.status==="PUBLISHED")await notifyListingIndexNow(result.listingId).catch(()=>undefined);return result}
export async function renewExpiredListingInTransaction(tx:any,listingId:string,userId:string,paid:boolean){return renewLocked(tx,listingId,userId,paid)}

export function startListingExpiryWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
 const intervalMs=Math.max(Number(process.env.LISTING_EXPIRY_WORKER_INTERVAL_MS??15*60*1000),60_000);let running=false;
 const tick=async()=>{if(running)return;running=true;try{const autoRenewed=await autoRenewProfessionalListings();const warnings=await notifyUpcomingListingExpirations();const processed=await expireDueListings();if(autoRenewed)log?.info({autoRenewed},"automatically renewed Pro listings");if(warnings)log?.info({warnings},"queued listing expiry warnings");if(processed)log?.info({processed},"expired published listings")}catch(error){log?.error(error,"listing expiry worker failed")}finally{running=false}};
 void tick();const timer=setInterval(()=>void tick(),intervalMs);timer.unref();return timer;
}
