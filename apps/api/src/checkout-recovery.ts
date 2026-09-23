import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { deliverUserEvent } from "./notification-delivery.js";
import { runObservedJob } from "./job-observability.js";
import { cancelMarketplaceCheckout } from "./marketplace-stripe.js";
import { requireAdminRoles } from "./rbac.js";

const FIRST_DELAY_MINUTES=30;
const SECOND_DELAY_HOURS=24;
const EXPIRE_DELAY_HOURS=72;
const WORKER_INTERVAL_MS=10*60_000;
const ADMIN_ROLES=["SUPER_ADMIN","ADMIN","FINANCE","MARKETING","SUPPORT"] as const;

type PendingRow={
 id:string;orderNumber:string;listingId:string;offerId:string|null;buyerId:string;currency:string;totalAmountMinor:number;
 paymentProvider:string|null;providerCheckoutId:string|null;createdAt:Date;updatedAt:Date;title:string|null;listingStatus:string;
 paymentStatus:string|null;
};

export async function ensureCheckoutRecoverySchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "CheckoutRecoveryReminder" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "MarketplaceOrder"("id") ON DELETE CASCADE,
  "stage" TEXT NOT NULL,
  "queuedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("orderId","stage")
 )`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CheckoutRecoveryReminder_stage_created_idx" ON "CheckoutRecoveryReminder"("stage","createdAt" DESC)`);
}

function checkoutUrl(row:PendingRow){
 const q=new URLSearchParams({listingId:row.listingId});
 if(row.offerId)q.set("offerId",row.offerId);
 return `/checkout?${q.toString()}`;
}

async function claimReminder(orderId:string,stage:"30M"|"24H"){
 const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(
  `INSERT INTO "CheckoutRecoveryReminder" ("id","orderId","stage") VALUES ($1,$2,$3) ON CONFLICT ("orderId","stage") DO NOTHING RETURNING "id"`,
  randomUUID(),orderId,stage,
 );
 return rows[0]?.id??null;
}

async function queueReminder(row:PendingRow,stage:"30M"|"24H"){
 const claim=await claimReminder(row.id,stage);if(!claim)return false;
 const title=stage==="30M"?"Votre achat est toujours disponible":"Vous souhaitez terminer votre achat ?";
 const item=row.title?.trim()||"cette annonce";
 const body=stage==="30M"
  ?`Vous avez commencé l’achat de « ${item} ». Le paiement n’est pas encore confirmé. Vous pouvez reprendre votre commande si l’annonce est toujours disponible.`
  :`Votre achat de « ${item} » n’est pas finalisé. Si vous souhaitez toujours cet article, vous pouvez reprendre le paiement depuis Petit Annonces.`;
 try{
  await deliverUserEvent({
   userId:row.buyerId,eventKind:"LISTING",notificationKind:"LISTING",title,body,actionUrl:checkoutUrl(row),
   dedupeKey:`checkout-recovery:${row.id}:${stage.toLowerCase()}`,
   metadata:{source:"CHECKOUT_RECOVERY",orderId:row.id,stage,paymentProvider:row.paymentProvider??null},
  });
  await prisma.$executeRawUnsafe(`UPDATE "CheckoutRecoveryReminder" SET "queuedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,claim);
  return true;
 }catch(error){
  await prisma.$executeRawUnsafe(`DELETE FROM "CheckoutRecoveryReminder" WHERE "id"=$1`,claim).catch(()=>undefined);
  throw error;
 }
}

async function expirePending(row:PendingRow){
 if(row.paymentProvider==="stripe-connect"&&row.providerCheckoutId){
  try{await cancelMarketplaceCheckout(row.providerCheckoutId)}
  catch(error){if(String(error).includes("payment_already_completed"))return false}
 }
 const changed=await prisma.$queryRawUnsafe<Array<{id:string}>>(`
  UPDATE "MarketplaceOrder" o SET "status"='CANCELED',"canceledAt"=COALESCE("canceledAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP
  WHERE o."id"=$1 AND o."status"='PENDING_PAYMENT'
    AND NOT EXISTS(SELECT 1 FROM "MarketplacePayment" p WHERE p."orderId"=o."id" AND p."status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))
  RETURNING o."id"`,row.id);
 if(!changed[0])return false;
 await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('CREATED','REQUIRES_ACTION','FAILED')`,row.id);
 return true;
}

export async function runCheckoutRecoverySweep(){
 await ensureCheckoutRecoverySchema();
 return runObservedJob("checkout-recovery-sweep",async()=>{
  const rows=await prisma.$queryRawUnsafe<PendingRow[]>(`
   SELECT o."id",o."orderNumber",o."listingId",o."offerId",o."buyerId",o."currency",o."totalAmountMinor",
     o."paymentProvider",o."providerCheckoutId",o."createdAt",o."updatedAt",l."title",l."status"::text AS "listingStatus",
     p."status"::text AS "paymentStatus"
   FROM "MarketplaceOrder" o
   JOIN "Listing" l ON l."id"=o."listingId"
   JOIN "User" u ON u."id"=o."buyerId" AND u."status"='ACTIVE'
   LEFT JOIN LATERAL (SELECT "status" FROM "MarketplacePayment" mp WHERE mp."orderId"=o."id" ORDER BY mp."createdAt" DESC LIMIT 1) p ON TRUE
   WHERE o."status"='PENDING_PAYMENT' AND o."createdAt"<CURRENT_TIMESTAMP-INTERVAL '${FIRST_DELAY_MINUTES} minutes'
     AND COALESCE(p."status"::text,'CREATED') NOT IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
   ORDER BY o."createdAt" ASC LIMIT 100`);
  let firstQueued=0,secondQueued=0,expired=0,skippedUnavailable=0,failed=0;
  for(const row of rows){
   try{
    const ageMs=Date.now()-new Date(row.createdAt).getTime();
    if(ageMs>=EXPIRE_DELAY_HOURS*3600_000){if(await expirePending(row))expired+=1;continue}
    if(row.listingStatus!=="PUBLISHED"){if(await expirePending(row))expired+=1;else skippedUnavailable+=1;continue}
    if(ageMs>=SECOND_DELAY_HOURS*3600_000){if(await queueReminder(row,"24H"))secondQueued+=1}
    else if(await queueReminder(row,"30M"))firstQueued+=1;
   }catch{failed+=1}
  }
  return{processed:rows.length,firstQueued,secondQueued,expired,skippedUnavailable,failed};
 });
}

export async function registerCheckoutRecoveryRoutes(app:FastifyInstance){
 await ensureCheckoutRecoverySchema();
 app.get("/admin/checkout-recovery",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
  const parsed=z.object({days:z.coerce.number().int().min(7).max(90).default(30)}).safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"invalid_period"});const days=parsed.data.days;
  const [summary,items]=await Promise.all([
   prisma.$queryRawUnsafe<Array<any>>(`
    SELECT
     COUNT(*) FILTER(WHERE o."status"='PENDING_PAYMENT' AND o."createdAt"<CURRENT_TIMESTAMP-INTERVAL '${FIRST_DELAY_MINUTES} minutes')::int AS abandoned,
     COUNT(*) FILTER(WHERE o."status"='PENDING_PAYMENT' AND o."createdAt"<CURRENT_TIMESTAMP-INTERVAL '${SECOND_DELAY_HOURS} hours')::int AS "over24h",
     COUNT(*) FILTER(WHERE r30."queuedAt" IS NOT NULL)::int AS "firstReminders",
     COUNT(*) FILTER(WHERE r24."queuedAt" IS NOT NULL)::int AS "secondReminders",
     COUNT(*) FILTER(WHERE o."status"='PAID' AND (r30."queuedAt" IS NOT NULL OR r24."queuedAt" IS NOT NULL))::int AS recovered,
     COALESCE(SUM(o."totalAmountMinor") FILTER(WHERE o."status"='PAID' AND (r30."queuedAt" IS NOT NULL OR r24."queuedAt" IS NOT NULL)),0)::bigint AS "recoveredGmvMinor"
    FROM "MarketplaceOrder" o
    LEFT JOIN "CheckoutRecoveryReminder" r30 ON r30."orderId"=o."id" AND r30."stage"='30M'
    LEFT JOIN "CheckoutRecoveryReminder" r24 ON r24."orderId"=o."id" AND r24."stage"='24H'
    WHERE o."createdAt">=CURRENT_DATE-($1::int-1)`,days),
   prisma.$queryRawUnsafe<Array<any>>(`
    SELECT o."id",o."orderNumber",o."status"::text AS "status",o."paymentProvider",o."currency",o."totalAmountMinor",o."createdAt",o."paidAt",
      l."title",r30."queuedAt" AS "firstReminderAt",r24."queuedAt" AS "secondReminderAt"
    FROM "MarketplaceOrder" o JOIN "Listing" l ON l."id"=o."listingId"
    LEFT JOIN "CheckoutRecoveryReminder" r30 ON r30."orderId"=o."id" AND r30."stage"='30M'
    LEFT JOIN "CheckoutRecoveryReminder" r24 ON r24."orderId"=o."id" AND r24."stage"='24H'
    WHERE o."createdAt">=CURRENT_DATE-($1::int-1)
      AND (o."status"='PENDING_PAYMENT' OR r30."id" IS NOT NULL OR r24."id" IS NOT NULL)
    ORDER BY o."createdAt" DESC LIMIT 80`,days),
  ]);
  const s=summary[0]??{};
  return reply.send({days,config:{firstDelayMinutes:FIRST_DELAY_MINUTES,secondDelayHours:SECOND_DELAY_HOURS,expireDelayHours:EXPIRE_DELAY_HOURS,emailProvider:"hostinger_smtp"},summary:{abandoned:Number(s.abandoned??0),over24h:Number(s.over24h??0),firstReminders:Number(s.firstReminders??0),secondReminders:Number(s.secondReminders??0),recovered:Number(s.recovered??0),recoveredGmvMinor:Number(s.recoveredGmvMinor??0)},items:items.map(row=>({...row,totalAmountMinor:Number(row.totalAmountMinor??0)}))});
 });
 app.post("/admin/checkout-recovery/run",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MARKETING"])},async(_request,reply)=>reply.send(await runCheckoutRecoverySweep()));
}

export function startCheckoutRecoveryWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
 let running=false;
 const tick=async()=>{if(running)return;running=true;try{const result=await runCheckoutRecoverySweep();if(Number((result as any)?.processed??0)>0)log?.info(result,"checkout recovery sweep processed")}catch(error){log?.error(error,"checkout recovery sweep failed")}finally{running=false}};
 const first=setTimeout(()=>void tick(),45_000);first.unref();
 const timer=setInterval(()=>void tick(),WORKER_INTERVAL_MS);timer.unref();
 return timer;
}
