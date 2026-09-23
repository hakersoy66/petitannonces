import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { getMangopayRuntime, MANGOPAY_WEBHOOK_EVENTS, mangopayApi } from "./admin-control.js";

const EVENTS=new Set<string>(MANGOPAY_WEBHOOK_EVENTS);

function tokenMatches(expected:string,supplied:string){const a=Buffer.from(expected),b=Buffer.from(supplied);return Boolean(expected&&a.length===b.length&&timingSafeEqual(a,b));}

async function ensureAuditSchema(){
  await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastError" TEXT`);
}

export async function ensureMangopayMarketplaceSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MarketplaceSellerPayoutProfile" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL UNIQUE,
    "provider" TEXT NOT NULL DEFAULT 'mangopay',
    "personType" TEXT,
    "providerUserId" TEXT UNIQUE,
    "providerWalletId" TEXT UNIQUE,
    "providerIdentityVerificationId" TEXT,
    "providerRecipientId" TEXT UNIQUE,
    "userStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kycLevel" TEXT NOT NULL DEFAULT 'LIGHT',
    "identityVerificationStatus" TEXT,
    "recipientStatus" TEXT NOT NULL DEFAULT 'NONE',
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "bankLast4" TEXT,
    "bankName" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketplaceSellerPayoutProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "MarketplaceSellerPayoutProfile_status_idx" ON "MarketplaceSellerPayoutProfile"("payoutsEnabled","kycLevel","recipientStatus")`);
}

async function confirmMangopayEvent(clientId:string,eventType:string,resourceId:string,date:number){
  const after=Math.max(0,date-180),before=date+180;
  const path=`/v2.01/${encodeURIComponent(clientId)}/events?EventType=${encodeURIComponent(eventType)}&AfterDate=${after}&BeforeDate=${before}`;
  const result=await mangopayApi(path);
  if(!result.response.ok||!Array.isArray(result.payload))throw new Error(`mangopay_event_lookup_${result.response.status}`);
  return result.payload.some((event:Record<string,unknown>)=>String(event.EventType??"")===eventType&&String(event.ResourceId??event.RessourceId??"")===resourceId&&Math.abs(Number(event.Date??0)-date)<=180);
}

async function reconcile(eventType:string,resourceId:string){
  if(eventType==="USER_ACCOUNT_VALIDATION_ASKED")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "userStatus"='PENDING_USER_ACTION',"payoutsEnabled"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "providerUserId"=$1`,resourceId);
  if(eventType==="USER_ACCOUNT_ACTIVATED"||eventType==="SCA_ENROLLMENT_SUCCEEDED")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "userStatus"='ACTIVE',"updatedAt"=CURRENT_TIMESTAMP WHERE "providerUserId"=$1`,resourceId);
  if(eventType==="USER_KYC_REGULAR")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "kycLevel"='REGULAR',"payoutsEnabled"=("recipientStatus"='ACTIVE'),"updatedAt"=CURRENT_TIMESTAMP WHERE "providerUserId"=$1`,resourceId);
  if(["USER_KYC_LIGHT","USER_KYC_RENEWAL_REQUIRED"].includes(eventType))await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "kycLevel"='LIGHT',"payoutsEnabled"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "providerUserId"=$1`,resourceId);
  if(eventType.startsWith("IDENTITY_VERIFICATION_"))await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "identityVerificationStatus"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "providerIdentityVerificationId"=$1`,resourceId,eventType.replace("IDENTITY_VERIFICATION_",""));
  if(eventType==="RECIPIENT_ACTIVE")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "recipientStatus"='ACTIVE',"payoutsEnabled"=("kycLevel"='REGULAR'),"updatedAt"=CURRENT_TIMESTAMP WHERE "providerRecipientId"=$1`,resourceId);
  if(eventType==="RECIPIENT_CANCELED")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "recipientStatus"='CANCELED',"payoutsEnabled"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "providerRecipientId"=$1`,resourceId);
  if(eventType==="RECIPIENT_DEACTIVATED")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceSellerPayoutProfile" SET "recipientStatus"='DEACTIVATED',"payoutsEnabled"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "providerRecipientId"=$1`,resourceId);
  if(eventType==="PAYIN_NORMAL_SUCCEEDED")await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CAPTURED',"capturedAt"=COALESCE("capturedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "providerPaymentId"=$1`,resourceId);
  if(eventType==="PAYIN_NORMAL_FAILED")await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='FAILED',"updatedAt"=CURRENT_TIMESTAMP WHERE "providerPaymentId"=$1 AND "status"<>'CAPTURED'`,resourceId);
  if(eventType==="PAYIN_REFUND_SUCCEEDED")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceRefund" SET "status"='SUCCEEDED',"updatedAt"=CURRENT_TIMESTAMP WHERE "providerRefundId"=$1`,resourceId);
  if(eventType==="PAYIN_REFUND_FAILED")await prisma.$executeRawUnsafe(`UPDATE "MarketplaceRefund" SET "status"='FAILED',"updatedAt"=CURRENT_TIMESTAMP WHERE "providerRefundId"=$1`,resourceId);
  if(eventType==="PAYOUT_NORMAL_SUCCEEDED")await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='PAID',"paidAt"=COALESCE("paidAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "providerPayoutId"=$1`,resourceId);
  if(eventType==="PAYOUT_NORMAL_FAILED")await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='FAILED',"updatedAt"=CURRENT_TIMESTAMP WHERE "providerPayoutId"=$1`,resourceId);
}

export async function registerMangopayMarketplaceRoutes(app:FastifyInstance){
  await ensureMangopayMarketplaceSchema();
  app.get("/marketplace/mangopay/webhook/:token",async(request,reply)=>{
    const runtime=await getMangopayRuntime();if(!runtime?.clientId||!runtime.webhookToken)return reply.code(404).send({error:"not_found"});
    const supplied=String((request.params as {token?:string})?.token??"");if(!tokenMatches(runtime.webhookToken,supplied))return reply.code(404).send({error:"not_found"});
    const query=request.query as Record<string,unknown>;const eventType=String(query.EventType??"");const resourceId=String(query.RessourceId??query.ResourceId??"");const date=Number(query.Date??0);
    if(!EVENTS.has(eventType)||!resourceId||!Number.isFinite(date)||date<=0)return reply.code(400).send({error:"invalid_mangopay_event"});
    let authentic=false;try{authentic=await confirmMangopayEvent(runtime.clientId,eventType,resourceId,date)}catch(error){request.log.error({error,eventType,resourceId},"mangopay webhook verification unavailable");return reply.code(503).send({received:false})}
    if(!authentic)return reply.code(401).send({error:"unverified_mangopay_event"});
    await ensureAuditSchema();const providerEventId=`${eventType}:${resourceId}:${date}`;const payloadHash=createHash("sha256").update(providerEventId).digest("hex");
    const inserted=await prisma.$queryRawUnsafe<Array<{id:string}>>(`INSERT INTO "PaymentWebhookEvent" ("id","provider","providerEventId","eventType","payloadHash","attemptCount","lastAttemptAt") VALUES ($1,'mangopay',$2,$3,$4,1,CURRENT_TIMESTAMP) ON CONFLICT ("provider","providerEventId") DO NOTHING RETURNING "id"`,randomUUID(),providerEventId,eventType,payloadHash);
    if(!inserted.length){await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "attemptCount"="attemptCount"+1,"lastAttemptAt"=CURRENT_TIMESTAMP WHERE "provider"='mangopay' AND "providerEventId"=$1`,providerEventId);return reply.send({received:true,duplicate:true})}
    try{await reconcile(eventType,resourceId);await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "processedAt"=CURRENT_TIMESTAMP,"lastError"=NULL WHERE "provider"='mangopay' AND "providerEventId"=$1`,providerEventId)}catch(error){const message=String(error instanceof Error?error.message:error).slice(0,1000);await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "lastError"=$1,"lastAttemptAt"=CURRENT_TIMESTAMP WHERE "provider"='mangopay' AND "providerEventId"=$2`,message,providerEventId).catch(()=>undefined);request.log.error({error,eventType,resourceId},"mangopay webhook reconcile failed");return reply.code(500).send({received:false})}
    return reply.send({received:true});
  });
}
