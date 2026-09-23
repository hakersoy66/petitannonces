import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getStripeBillingRuntime } from "./admin-control.js";
import { requireListingUser } from "./listing-auth.js";
import { deliverUserEvent } from "./notification-delivery.js";
import { getSellerPayoutReadiness } from "./marketplace-payout-provider.js";
import { transferVacationDepositPayout } from "./marketplace-stripe.js";
import { vacationPayoutBlockedByIncident } from "./vacation-stay-lifecycle.js";

export type VacationDepositPaymentStatus="PENDING"|"PAID"|"PARTIALLY_REFUNDED"|"REFUND_PENDING"|"REFUNDED"|"FAILED"|"CANCELED";
export type VacationDepositPayoutStatus="PENDING"|"HOLD"|"PROCESSING"|"PAID"|"FAILED"|"CANCELED";

export async function ensureVacationPaymentSchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VacationDepositPayment" (
  "id" TEXT PRIMARY KEY,
  "reservationId" TEXT NOT NULL REFERENCES "VacationReservationRequest"("id") ON DELETE CASCADE,
  "provider" TEXT NOT NULL DEFAULT 'stripe',
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "providerCheckoutId" TEXT NULL,
  "checkoutUrl" TEXT NULL,
  "providerPaymentId" TEXT NULL,
  "providerRefundId" TEXT NULL,
  "refundedAmountMinor" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMPTZ NULL,
  "refundedAt" TIMESTAMPTZ NULL,
  CONSTRAINT "VacationDepositPayment_amount" CHECK ("amountMinor">0),
  CONSTRAINT "VacationDepositPayment_status" CHECK ("status" IN ('PENDING','PAID','PARTIALLY_REFUNDED','REFUND_PENDING','REFUNDED','FAILED','CANCELED'))
 )`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "VacationDepositPayment" ADD COLUMN IF NOT EXISTS "checkoutUrl" TEXT NULL`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "VacationDepositPayment" ADD COLUMN IF NOT EXISTS "refundedAmountMinor" INTEGER NOT NULL DEFAULT 0`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "VacationDepositPayment" DROP CONSTRAINT IF EXISTS "VacationDepositPayment_status"`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "VacationDepositPayment" ADD CONSTRAINT "VacationDepositPayment_status" CHECK ("status" IN ('PENDING','PAID','PARTIALLY_REFUNDED','REFUND_PENDING','REFUNDED','FAILED','CANCELED'))`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VacationDepositPayment_reservation_idx" ON "VacationDepositPayment" ("reservationId","createdAt" DESC)`);
 await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "VacationDepositPayment_active_unique"`);
 await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "VacationDepositPayment_active_unique" ON "VacationDepositPayment" ("reservationId") WHERE "status" IN ('PENDING','PAID','PARTIALLY_REFUNDED','REFUND_PENDING')`);
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VacationDepositPayout" (
  "id" TEXT PRIMARY KEY,
  "reservationId" TEXT NOT NULL UNIQUE REFERENCES "VacationReservationRequest"("id") ON DELETE CASCADE,
  "paymentId" TEXT NOT NULL UNIQUE REFERENCES "VacationDepositPayment"("id") ON DELETE CASCADE,
  "hostId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "eligibleAt" TIMESTAMPTZ NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NULL,
  "providerPayoutId" TEXT NULL,
  "failureReason" TEXT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" TIMESTAMPTZ NULL,
  CONSTRAINT "VacationDepositPayout_amount" CHECK ("amountMinor">0),
  CONSTRAINT "VacationDepositPayout_status" CHECK ("status" IN ('PENDING','HOLD','PROCESSING','PAID','FAILED','CANCELED'))
 )`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VacationDepositPayout_due_idx" ON "VacationDepositPayout" ("status","eligibleAt")`);
}

async function stripePost(path:string,params:URLSearchParams,idempotencyKey?:string){
 const runtime=await getStripeBillingRuntime();
 if(!runtime?.apiKey)throw new Error("stripe_billing_not_configured");
 const headers:Record<string,string>={authorization:`Bearer ${runtime.apiKey}`,"content-type":"application/x-www-form-urlencoded"};
 if(idempotencyKey)headers["idempotency-key"]=idempotencyKey;
 const response=await fetch(`https://api.stripe.com${path}`,{method:"POST",headers,body:params.toString()});
 const payload=await response.json().catch(()=>({})) as any;
 if(!response.ok)throw new Error(`stripe_${response.status}_${String(payload?.error?.type??payload?.error?.code??"error")}`);
 return payload;
}

async function createDepositCheckout(input:{paymentId:string;reservationId:string;title:string;amountMinor:number;currency:string;idempotencyKey:string;client?:"WEB"|"NATIVE";appScheme?:"petitannonces"|"petitannonces-development"|"petitannonces-preview"}){
 const params=new URLSearchParams();
 params.set("mode","payment");
 params.set("expires_at",String(Math.floor(Date.now()/1000)+30*60));
 params.set("client_reference_id",input.reservationId);
 const nativeReturn=input.client==="NATIVE";const scheme=input.appScheme??"petitannonces";
 params.set("success_url",nativeReturn?`https://petitannonces.fr/app/return?target=reservations&result=success&reservationId=${encodeURIComponent(input.reservationId)}&scheme=${encodeURIComponent(scheme)}`:`https://petitannonces.fr/mon-compte/reservations?acompte=success&reservationId=${encodeURIComponent(input.reservationId)}`);
 params.set("cancel_url",nativeReturn?`https://petitannonces.fr/app/return?target=reservations&result=cancel&reservationId=${encodeURIComponent(input.reservationId)}&scheme=${encodeURIComponent(scheme)}`:`https://petitannonces.fr/mon-compte/reservations?acompte=annule&reservationId=${encodeURIComponent(input.reservationId)}`);
 params.set("line_items[0][price_data][currency]",input.currency.toLowerCase());
 params.set("line_items[0][price_data][unit_amount]",String(input.amountMinor));
 params.set("line_items[0][price_data][product_data][name]",`Acompte réservation · ${input.title.slice(0,90)}`);
 params.set("line_items[0][quantity]","1");
 params.set("metadata[pa_vacation_reservation_id]",input.reservationId);
 params.set("metadata[pa_vacation_deposit_payment_id]",input.paymentId);
 params.set("payment_intent_data[metadata][pa_vacation_reservation_id]",input.reservationId);
 params.set("payment_intent_data[metadata][pa_vacation_deposit_payment_id]",input.paymentId);
 const session=await stripePost("/v1/checkout/sessions",params,input.idempotencyKey);
 return{id:String(session.id??""),url:String(session.url??"")};
}

async function refundDeposit(input:{reservationId:string;paymentId:string;providerPaymentId:string;amountMinor:number;idempotencyKey:string}){
 const params=new URLSearchParams();
 params.set("payment_intent",input.providerPaymentId);
 params.set("amount",String(input.amountMinor));
 params.set("metadata[pa_vacation_reservation_id]",input.reservationId);
 params.set("metadata[pa_vacation_deposit_payment_id]",input.paymentId);
 const refund=await stripePost("/v1/refunds",params,input.idempotencyKey);
 return{id:String(refund.id??""),status:String(refund.status??"pending")};
}

async function ensurePayoutForPayment(paymentId:string){
 const rows=await prisma.$queryRawUnsafe<Array<{paymentId:string;reservationId:string;hostId:string;amountMinor:number;currency:string;eligibleAt:Date}>>(`SELECT p."id" AS "paymentId",r."id" AS "reservationId",r."hostId",p."amountMinor",p."currency",((r."checkIn" + 2)::timestamp AT TIME ZONE 'Europe/Paris') AS "eligibleAt" FROM "VacationDepositPayment" p JOIN "VacationReservationRequest" r ON r."id"=p."reservationId" WHERE p."id"=$1 AND p."status"='PAID' AND r."status"='ACCEPTED' LIMIT 1`,paymentId);
 const row=rows[0];if(!row)return null;
 const id=randomUUID();
 await prisma.$executeRawUnsafe(`INSERT INTO "VacationDepositPayout" ("id","reservationId","paymentId","hostId","amountMinor","currency","eligibleAt","status") VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING') ON CONFLICT ("paymentId") DO NOTHING`,id,row.reservationId,row.paymentId,row.hostId,row.amountMinor,row.currency,row.eligibleAt);
 return row;
}

async function backfillVacationDepositPayouts(){
 const rows=await prisma.$queryRawUnsafe<Array<{paymentId:string}>>(`SELECT p."id" AS "paymentId" FROM "VacationDepositPayment" p JOIN "VacationReservationRequest" r ON r."id"=p."reservationId" LEFT JOIN "VacationDepositPayout" vp ON vp."paymentId"=p."id" WHERE p."status"='PAID' AND r."status"='ACCEPTED' AND vp."id" IS NULL LIMIT 100`);
 for(const row of rows)await ensurePayoutForPayment(row.paymentId);
}

export async function latestVacationDepositPayments(reservationIds:string[]){
 if(!reservationIds.length)return new Map<string,{id:string;status:VacationDepositPaymentStatus;amountMinor:number;currency:string;providerCheckoutId:string|null;providerPaymentId:string|null;providerRefundId:string|null;paidAt:Date|null;refundedAt:Date|null}>();
 const rows=await prisma.$queryRawUnsafe<Array<{id:string;reservationId:string;status:VacationDepositPaymentStatus;amountMinor:number;currency:string;providerCheckoutId:string|null;providerPaymentId:string|null;providerRefundId:string|null;paidAt:Date|null;refundedAt:Date|null}>>(`SELECT DISTINCT ON ("reservationId") "id","reservationId","status","amountMinor","currency","providerCheckoutId","providerPaymentId","providerRefundId","paidAt","refundedAt" FROM "VacationDepositPayment" WHERE "reservationId"=ANY($1::text[]) ORDER BY "reservationId","createdAt" DESC`,reservationIds);
 return new Map(rows.map(row=>[row.reservationId,row]));
}

export async function latestVacationDepositPayouts(reservationIds:string[]){
 if(!reservationIds.length)return new Map<string,{id:string;status:VacationDepositPayoutStatus;amountMinor:number;currency:string;eligibleAt:Date;provider:string|null;providerPayoutId:string|null;failureReason:string|null;paidAt:Date|null}>();
 const rows=await prisma.$queryRawUnsafe<Array<{id:string;reservationId:string;status:VacationDepositPayoutStatus;amountMinor:number;currency:string;eligibleAt:Date;provider:string|null;providerPayoutId:string|null;failureReason:string|null;paidAt:Date|null}>>(`SELECT "id","reservationId","status","amountMinor","currency","eligibleAt","provider","providerPayoutId","failureReason","paidAt" FROM "VacationDepositPayout" WHERE "reservationId"=ANY($1::text[])`,reservationIds);
 return new Map(rows.map(row=>[row.reservationId,row]));
}

async function processVacationDepositPayout(payoutId:string){
 const rows=await prisma.$queryRawUnsafe<Array<{id:string;reservationId:string;paymentId:string;hostId:string;amountMinor:number;currency:string;eligibleAt:Date;status:VacationDepositPayoutStatus;failureReason:string|null;paymentStatus:VacationDepositPaymentStatus;reservationStatus:string;title:string|null}>>(`SELECT vp."id",vp."reservationId",vp."paymentId",vp."hostId",vp."amountMinor",vp."currency",vp."eligibleAt",vp."status",vp."failureReason",p."status" AS "paymentStatus",r."status" AS "reservationStatus",l."title" FROM "VacationDepositPayout" vp JOIN "VacationDepositPayment" p ON p."id"=vp."paymentId" JOIN "VacationReservationRequest" r ON r."id"=vp."reservationId" JOIN "Listing" l ON l."id"=r."listingId" WHERE vp."id"=$1 LIMIT 1`,payoutId);
 const payout=rows[0];if(!payout||payout.eligibleAt.getTime()>Date.now())return false;
 if(payout.status==="HOLD"&&["vacation_incident_manual_hold","vacation_refund_review"].includes(payout.failureReason??""))return false;
 if(payout.paymentStatus==="REFUND_PENDING"){await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='HOLD',"failureReason"='refund_pending',"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payout.id);return false;}
 if(!["PAID","PARTIALLY_REFUNDED"].includes(payout.paymentStatus)||!["ACCEPTED","CANCELLED"].includes(payout.reservationStatus)){await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='CANCELED',"failureReason"='payment_or_reservation_not_payable',"updatedAt"=NOW() WHERE "id"=$1 AND "status"<>'PAID'`,payout.id);return false;}
 if(await vacationPayoutBlockedByIncident(payout.reservationId)){await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='HOLD',"failureReason"='vacation_incident_open',"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payout.id);return false;}
 const readiness=await getSellerPayoutReadiness(payout.hostId).catch(()=>null);
 if(!readiness?.sellerReady||!readiness.providerOperational){await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='HOLD',"failureReason"=$2,"lastAttemptAt"=NOW(),"attemptCount"="attemptCount"+1,"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payout.id,readiness?.reason??"PAYOUT_ACCOUNT_NOT_READY");return false;}
 const claimed=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "VacationDepositPayout" SET "status"='PROCESSING',"failureReason"=NULL,"lastAttemptAt"=NOW(),"attemptCount"="attemptCount"+1,"updatedAt"=NOW() WHERE "id"=$1 AND "eligibleAt"<=NOW() AND "status" IN ('PENDING','HOLD','FAILED') RETURNING "id"`,payout.id);if(!claimed.length)return false;
 try{
  const result=await transferVacationDepositPayout({sellerId:payout.hostId,reservationId:payout.reservationId,payoutId:payout.id,amountMinor:payout.amountMinor,currency:payout.currency,idempotencyKey:`vacation-deposit-payout-${payout.id}`});
  const changed=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "VacationDepositPayout" SET "status"='PAID',"provider"='stripe-connect',"providerPayoutId"=$2,"paidAt"=COALESCE("paidAt",NOW()),"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PROCESSING' RETURNING "id"`,payout.id,result.id);
  if(changed.length)await Promise.all([
   deliverUserEvent({userId:payout.hostId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Acompte versé",body:`L’acompte de ${payout.title??"votre réservation Vacances"} a été envoyé vers votre compte de versement.`,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:`vacation-payout:${payout.id}:paid:host`,metadata:{reservationId:payout.reservationId,payoutId:payout.id,status:"PAID"}}),
  ]).catch(()=>undefined);
  return true;
 }catch(error){const reason=String(error instanceof Error?error.message:error).slice(0,500);await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='FAILED',"failureReason"=$2,"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PROCESSING'`,payout.id,reason);return false;}
}

export async function runVacationDepositPayoutSweep(){
 await ensureVacationPaymentSchema();
 await backfillVacationDepositPayouts();
 await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='FAILED',"failureReason"='stale_processing_retry',"updatedAt"=NOW() WHERE "status"='PROCESSING' AND "updatedAt"<NOW()-INTERVAL '45 minutes'`);
 const due=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "VacationDepositPayout" WHERE "eligibleAt"<=NOW() AND ("status"='PENDING' OR ("status" IN ('HOLD','FAILED') AND "updatedAt"<NOW()-INTERVAL '15 minutes')) ORDER BY "eligibleAt" ASC LIMIT 30`);
 let paid=0;for(const row of due)if(await processVacationDepositPayout(row.id))paid++;
 return{checked:due.length,paid};
}

let payoutWorkerStarted=false;
export function startVacationDepositPayoutWorker(log:{info:(obj:unknown,msg?:string)=>void;error:(obj:unknown,msg?:string)=>void}){
 if(payoutWorkerStarted)return;payoutWorkerStarted=true;
 const run=()=>runVacationDepositPayoutSweep().then(result=>{if(result.checked)log.info(result,"vacation deposit payout sweep")}).catch(error=>log.error({error},"vacation deposit payout sweep failed"));
 const first=setTimeout(run,20_000);first.unref();const timer=setInterval(run,15*60_000);timer.unref();
}

export async function handleVacationStripeEvent(type:string,obj:any){
 const reservationId=String(obj?.metadata?.pa_vacation_reservation_id??"");
 const paymentId=String(obj?.metadata?.pa_vacation_deposit_payment_id??"");
 const payoutId=String(obj?.metadata?.pa_vacation_deposit_payout_id??"");
 if(!reservationId&&!paymentId&&!payoutId)return false;
 if(payoutId&&type.startsWith("transfer.")){
  if(type==="transfer.reversed"){await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='FAILED',"failureReason"='transfer_reversed',"updatedAt"=NOW() WHERE "id"=$1`,payoutId);return true;}
  if(type==="transfer.created"){await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='PAID',"provider"='stripe-connect',"providerPayoutId"=COALESCE("providerPayoutId",$2),"paidAt"=COALESCE("paidAt",NOW()),"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PROCESSING','PAID')`,payoutId,typeof obj?.id==="string"?obj.id:null);return true;}
  return true;
 }
 const rows=await prisma.$queryRawUnsafe<Array<{id:string;reservationId:string;status:VacationDepositPaymentStatus;amountMinor:number;currency:string;providerPaymentId:string|null;providerRefundId:string|null;refundedAmountMinor:number;guestId:string;hostId:string;title:string|null}>>(`SELECT p."id",p."reservationId",p."status",p."amountMinor",p."currency",p."providerPaymentId",p."providerRefundId",p."refundedAmountMinor",r."guestId",r."hostId",l."title" FROM "VacationDepositPayment" p JOIN "VacationReservationRequest" r ON r."id"=p."reservationId" JOIN "Listing" l ON l."id"=r."listingId" WHERE ${paymentId?'p."id"=$1':'p."reservationId"=$1'} ORDER BY p."createdAt" DESC LIMIT 1`,paymentId||reservationId);
 const payment=rows[0];if(!payment)return true;
 if(type==="checkout.session.expired"||type==="checkout.session.async_payment_failed"||type==="payment_intent.payment_failed"){
  await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "status"='FAILED',"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PENDING'`,payment.id);return true;
 }
 if(type==="checkout.session.completed"||type==="checkout.session.async_payment_succeeded"){
  if(String(obj?.payment_status??"").toLowerCase()!=="paid")return true;
  const providerPaymentId=typeof obj?.payment_intent==="string"?obj.payment_intent:payment.providerPaymentId;
  const changed=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "VacationDepositPayment" SET "status"='PAID',"providerPaymentId"=COALESCE($2,"providerPaymentId"),"paidAt"=COALESCE("paidAt",NOW()),"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PENDING' RETURNING "id"`,payment.id,providerPaymentId);
  if(changed.length){await ensurePayoutForPayment(payment.id);await Promise.all([
   deliverUserEvent({userId:payment.guestId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Acompte payé",body:`Votre acompte pour ${payment.title??"la réservation Vacances"} a été confirmé. Petit Annonces le conserve jusqu’à 2 jours après votre arrivée avant le versement à l’hôte.`,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:`vacation-deposit:${payment.id}:paid:guest`,metadata:{reservationId:payment.reservationId,paymentId:payment.id,status:"PAID"}}),
   deliverUserEvent({userId:payment.hostId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Acompte payé par le voyageur",body:`Le paiement de l’acompte pour ${payment.title??"votre hébergement"} est confirmé. Le versement sera éligible 2 jours après la date d’arrivée.`,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:`vacation-deposit:${payment.id}:paid:host`,metadata:{reservationId:payment.reservationId,paymentId:payment.id,status:"PAID"}}),
  ]).catch(()=>undefined);}
  return true;
 }
 if(type==="refund.updated"){
  const providerRefundId=typeof obj?.id==="string"?obj.id:null;const stripeStatus=String(obj?.status??"").toLowerCase();const refundAmount=Math.max(0,Number(obj?.amount??0)||0);
  if(providerRefundId&&payment.providerRefundId===providerRefundId&&["PARTIALLY_REFUNDED","REFUNDED"].includes(payment.status))return true;
  if(stripeStatus==="failed"||stripeStatus==="canceled"){
   const restored:VacationDepositPaymentStatus=payment.refundedAmountMinor>0?"PARTIALLY_REFUNDED":"PAID";
   await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "status"=$2,"updatedAt"=NOW() WHERE "id"=$1 AND "status"='REFUND_PENDING'`,payment.id,restored);await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='PENDING',"failureReason"=NULL,"updatedAt"=NOW() WHERE "paymentId"=$1 AND "status"='HOLD' AND "failureReason"='refund_pending'`,payment.id)});return true;
  }
  if(stripeStatus!=="succeeded"){
   await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "status"='REFUND_PENDING',"providerRefundId"=COALESCE($2,"providerRefundId"),"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PAID','PARTIALLY_REFUNDED','REFUND_PENDING')`,payment.id,providerRefundId);await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='HOLD',"failureReason"='refund_pending',"updatedAt"=NOW() WHERE "paymentId"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payment.id)});return true;
  }
  const refundedTotal=Math.min(payment.amountMinor,Math.max(payment.refundedAmountMinor,0)+refundAmount);const remaining=Math.max(0,payment.amountMinor-refundedTotal);const next:VacationDepositPaymentStatus=remaining===0?"REFUNDED":"PARTIALLY_REFUNDED";
  const changed=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "VacationDepositPayment" SET "status"=$2,"providerRefundId"=COALESCE($3,"providerRefundId"),"refundedAmountMinor"=$4,"refundedAt"=CASE WHEN $2='REFUNDED' THEN COALESCE("refundedAt",NOW()) ELSE "refundedAt" END,"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PAID','PARTIALLY_REFUNDED','REFUND_PENDING','REFUNDED') RETURNING "id"`,payment.id,next,providerRefundId,refundedTotal);
  if(remaining===0)await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='CANCELED',"failureReason"='deposit_refunded',"updatedAt"=NOW() WHERE "paymentId"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payment.id);else await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "amountMinor"=$2,"status"='PENDING',"failureReason"=NULL,"updatedAt"=NOW() WHERE "paymentId"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payment.id,remaining);
  if(changed.length)await Promise.all([
   deliverUserEvent({userId:payment.guestId,eventKind:"LISTING",notificationKind:"SYSTEM",title:next==="REFUNDED"?"Acompte remboursé":"Acompte partiellement remboursé",body:next==="REFUNDED"?`Le remboursement de votre acompte pour ${payment.title??"la réservation Vacances"} a été confirmé.`:`Un remboursement partiel de votre acompte pour ${payment.title??"la réservation Vacances"} a été confirmé.`,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:`vacation-deposit:${payment.id}:${providerRefundId??refundedTotal}:refund:guest`,metadata:{reservationId:payment.reservationId,paymentId:payment.id,status:next,refundedAmountMinor:refundedTotal}}),
   deliverUserEvent({userId:payment.hostId,eventKind:"LISTING",notificationKind:"SYSTEM",title:next==="REFUNDED"?"Acompte remboursé":"Acompte partiellement remboursé",body:next==="REFUNDED"?`Le remboursement de l’acompte pour ${payment.title??"votre hébergement"} a été confirmé.`:`Un remboursement partiel de l’acompte pour ${payment.title??"votre hébergement"} a été confirmé. Le solde restant suit la règle de versement prévue.`,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:`vacation-deposit:${payment.id}:${providerRefundId??refundedTotal}:refund:host`,metadata:{reservationId:payment.reservationId,paymentId:payment.id,status:next,refundedAmountMinor:refundedTotal}}),
  ]).catch(()=>undefined);
  return true;
 }
 return true;
}

export async function applyVacationCancellationPayment(input:{reservationId:string;refundPercent:number}){
 await ensureVacationPaymentSchema();
 const payments=await prisma.$queryRawUnsafe<Array<{id:string;status:VacationDepositPaymentStatus;amountMinor:number;currency:string;providerCheckoutId:string|null;providerPaymentId:string|null;providerRefundId:string|null;refundedAmountMinor:number}>>(`SELECT "id","status","amountMinor","currency","providerCheckoutId","providerPaymentId","providerRefundId","refundedAmountMinor" FROM "VacationDepositPayment" WHERE "reservationId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,input.reservationId);
 const payment=payments[0];if(!payment)return{paymentStatus:null,refundAmountMinor:0,remainingAmountMinor:0,refundStatus:"NO_PAYMENT" as const};
 const payoutRows=await prisma.$queryRawUnsafe<Array<{id:string;status:VacationDepositPayoutStatus;amountMinor:number}>>(`SELECT "id","status","amountMinor" FROM "VacationDepositPayout" WHERE "paymentId"=$1 LIMIT 1`,payment.id);const payout=payoutRows[0]??null;
 if(payout&&["PROCESSING","PAID"].includes(payout.status))throw new Error("deposit_already_released_support_required");
 if(payment.status==="PENDING"){
  if(payment.providerCheckoutId){try{await stripePost(`/v1/checkout/sessions/${encodeURIComponent(payment.providerCheckoutId)}/expire`,new URLSearchParams())}catch{throw new Error("deposit_payment_state_requires_sync")}}
  await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "status"='CANCELED',"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PENDING'`,payment.id);await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='CANCELED',"failureReason"='reservation_cancelled_before_payment',"updatedAt"=NOW() WHERE "paymentId"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payment.id)});
  return{paymentStatus:"CANCELED" as const,refundAmountMinor:0,remainingAmountMinor:0,refundStatus:"NO_CAPTURE" as const};
 }
 if(["FAILED","CANCELED","REFUNDED"].includes(payment.status))return{paymentStatus:payment.status,refundAmountMinor:0,remainingAmountMinor:0,refundStatus:payment.status==="REFUNDED"?"REFUNDED" as const:"NO_CAPTURE" as const};
 if(payment.status==="REFUND_PENDING")throw new Error("deposit_refund_already_pending");
 if(!["PAID","PARTIALLY_REFUNDED"].includes(payment.status)||!payment.providerPaymentId)throw new Error("deposit_payment_state_requires_sync");
 const alreadyRefunded=Math.max(0,payment.refundedAmountMinor||0),remainingBefore=Math.max(0,payment.amountMinor-alreadyRefunded);const requested=Math.min(remainingBefore,Math.round(payment.amountMinor*Math.max(0,Math.min(100,input.refundPercent))/100));
 if(requested<=0)return{paymentStatus:payment.status,refundAmountMinor:0,remainingAmountMinor:remainingBefore,refundStatus:"NO_REFUND" as const};
 const key=`vacation-cancel-refund-${payment.id}-${requested}`;const refund=await refundDeposit({reservationId:input.reservationId,paymentId:payment.id,providerPaymentId:payment.providerPaymentId,amountMinor:requested,idempotencyKey:key});const immediate=refund.status.toLowerCase()==="succeeded";const refundedTotal=immediate?Math.min(payment.amountMinor,alreadyRefunded+requested):alreadyRefunded;const remainingAfter=Math.max(0,payment.amountMinor-refundedTotal);const nextStatus:VacationDepositPaymentStatus=immediate?(remainingAfter===0?"REFUNDED":"PARTIALLY_REFUNDED"):"REFUND_PENDING";
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "status"=$2,"providerRefundId"=$3,"refundedAmountMinor"=$4,"refundedAt"=CASE WHEN $2='REFUNDED' THEN COALESCE("refundedAt",NOW()) ELSE "refundedAt" END,"updatedAt"=NOW() WHERE "id"=$1`,payment.id,nextStatus,refund.id,refundedTotal);
  if(payout){if(!immediate)await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='HOLD',"failureReason"='refund_pending',"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payout.id);else if(remainingAfter<=0)await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='CANCELED',"failureReason"='deposit_refunded',"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payout.id);else await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "amountMinor"=$2,"status"=CASE WHEN "status"='FAILED' THEN 'PENDING' ELSE "status" END,"failureReason"=NULL,"updatedAt"=NOW() WHERE "id"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payout.id,remainingAfter)}
 });
 return{paymentStatus:nextStatus,refundAmountMinor:requested,remainingAmountMinor:immediate?remainingAfter:remainingBefore,refundStatus:immediate?"REFUNDED" as const:"PENDING" as const};
}

export async function registerVacationPaymentRoutes(app:FastifyInstance){
 app.post("/vacances/reservations/:id/deposit-checkout",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;const id=String((request.params as {id?:string})?.id??"");if(!id)return reply.code(400).send({error:"invalid_request"});const body=z.object({client:z.enum(["WEB","NATIVE"]).optional().default("WEB"),appScheme:z.enum(["petitannonces","petitannonces-development","petitannonces-preview"]).optional().default("petitannonces")}).safeParse(request.body??{});if(!body.success)return reply.code(400).send({error:"invalid_request"});
  const rows=await prisma.$queryRawUnsafe<Array<{id:string;guestId:string;status:string;depositEnabled:boolean;depositAmountMinor:number;currency:string;title:string|null}>>(`SELECT r."id",r."guestId",r."status",r."depositEnabled",r."depositAmountMinor",r."currency",l."title" FROM "VacationReservationRequest" r JOIN "Listing" l ON l."id"=r."listingId" WHERE r."id"=$1 LIMIT 1`,id);const reservation=rows[0];
  if(!reservation||reservation.guestId!==user.id)return reply.code(404).send({error:"reservation_not_found"});if(reservation.status!=="ACCEPTED")return reply.code(409).send({error:"reservation_not_accepted"});if(!reservation.depositEnabled||reservation.depositAmountMinor<=0)return reply.code(409).send({error:"deposit_not_required"});
  const active=await prisma.$queryRawUnsafe<Array<{id:string;status:VacationDepositPaymentStatus;checkoutUrl:string|null;amountMinor:number;currency:string}>>(`SELECT "id","status","checkoutUrl","amountMinor","currency" FROM "VacationDepositPayment" WHERE "reservationId"=$1 AND "status" IN ('PENDING','PAID','REFUND_PENDING','REFUNDED') ORDER BY "createdAt" DESC LIMIT 1`,id);if(active[0]){if(active[0].status==="PENDING"&&active[0].checkoutUrl)return reply.send({checkoutUrl:active[0].checkoutUrl,payment:{id:active[0].id,status:active[0].status,amountMinor:active[0].amountMinor,currency:active[0].currency},resumed:true});return reply.code(409).send({error:active[0].status==="PENDING"?"deposit_checkout_already_created":"deposit_already_settled",status:active[0].status});}
  const paymentId=randomUUID(),key=`vacation-deposit-${paymentId}`;await prisma.$executeRawUnsafe(`INSERT INTO "VacationDepositPayment" ("id","reservationId","provider","amountMinor","currency","status","idempotencyKey") VALUES ($1,$2,'stripe',$3,$4,'PENDING',$5)`,paymentId,id,reservation.depositAmountMinor,reservation.currency,key);
  try{const checkout=await createDepositCheckout({paymentId,reservationId:id,title:reservation.title??"Hébergement Petit Annonces Vacances",amountMinor:reservation.depositAmountMinor,currency:reservation.currency,idempotencyKey:key,client:body.data.client,appScheme:body.data.appScheme});if(!checkout.id||!checkout.url)throw new Error("stripe_checkout_missing");await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "providerCheckoutId"=$2,"checkoutUrl"=$3,"updatedAt"=NOW() WHERE "id"=$1`,paymentId,checkout.id,checkout.url);return reply.send({checkoutUrl:checkout.url,payment:{id:paymentId,status:"PENDING",amountMinor:reservation.depositAmountMinor,currency:reservation.currency}})}catch(error){await prisma.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "status"='FAILED',"updatedAt"=NOW() WHERE "id"=$1`,paymentId).catch(()=>undefined);request.log.error({error,reservationId:id},"vacation deposit checkout failed");return reply.code(502).send({error:"deposit_checkout_unavailable"})}
 });
 app.post("/vacances/reservations/:id/deposit-refund",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;const id=String((request.params as {id?:string})?.id??"");if(!id)return reply.code(400).send({error:"invalid_request"});
  const rows=await prisma.$queryRawUnsafe<Array<{id:string;hostId:string}>>(`SELECT "id","hostId" FROM "VacationReservationRequest" WHERE "id"=$1 LIMIT 1`,id);if(!rows[0]||rows[0].hostId!==user.id)return reply.code(404).send({error:"reservation_not_found"});
  const payments=await prisma.$queryRawUnsafe<Array<{id:string;status:VacationDepositPaymentStatus;amountMinor:number;providerPaymentId:string|null}>>(`SELECT "id","status","amountMinor","providerPaymentId" FROM "VacationDepositPayment" WHERE "reservationId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,id);const payment=payments[0];if(!payment||payment.status!=="PAID"||!payment.providerPaymentId)return reply.code(409).send({error:"deposit_not_refundable"});
  const payout=await prisma.$queryRawUnsafe<Array<{status:VacationDepositPayoutStatus}>>(`SELECT "status" FROM "VacationDepositPayout" WHERE "paymentId"=$1 LIMIT 1`,payment.id);if(payout[0]&&["PROCESSING","PAID"].includes(payout[0].status))return reply.code(409).send({error:"deposit_already_released"});
  const key=`vacation-deposit-refund-${payment.id}`;try{const refund=await refundDeposit({reservationId:id,paymentId:payment.id,providerPaymentId:payment.providerPaymentId,amountMinor:payment.amountMinor,idempotencyKey:key});const next=refund.status.toLowerCase()==="succeeded"?"REFUNDED":"REFUND_PENDING";await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayment" SET "status"=$2,"providerRefundId"=$3,"refundedAmountMinor"=CASE WHEN $2='REFUNDED' THEN "amountMinor" ELSE "refundedAmountMinor" END,"refundedAt"=CASE WHEN $2='REFUNDED' THEN NOW() ELSE "refundedAt" END,"updatedAt"=NOW() WHERE "id"=$1 AND "status"='PAID'`,payment.id,next,refund.id);await tx.$executeRawUnsafe(`UPDATE "VacationDepositPayout" SET "status"='CANCELED',"failureReason"='deposit_refund',"updatedAt"=NOW() WHERE "paymentId"=$1 AND "status" IN ('PENDING','HOLD','FAILED')`,payment.id);});return reply.send({saved:true,status:next})}catch(error){request.log.error({error,reservationId:id,paymentId:payment.id},"vacation deposit refund failed");return reply.code(502).send({error:"deposit_refund_unavailable"})}
 });
}