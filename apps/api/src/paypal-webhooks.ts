import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { getRuntimeIntegration } from "./admin-control.js";
import { capturePayPalOrder, getPayPalOrder, paypalCaptureFromOrder, refundPayPalCapture, verifyPayPalWebhookSignature } from "./paypal-checkout.js";
import { deliverUserEvent } from "./notification-delivery.js";

function amountMinor(value:unknown){const n=Number(value??0);return Number.isFinite(n)?Math.round(n*100):0}
function eventHash(value:string){return createHash("sha256").update(value).digest("hex")}
async function ensureAuditSchema(){
 await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3)`);
 await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentWebhookEvent" ADD COLUMN IF NOT EXISTS "lastError" TEXT`);
}

async function findOrderByPayPalOrder(paypalOrderId:string){
 const rows=await prisma.$queryRawUnsafe<Array<{id:string;orderNumber:string;listingId:string;buyerId:string;sellerId:string;currency:string;totalAmountMinor:number;status:string;providerCheckoutId:string|null}>>(
  `SELECT "id","orderNumber","listingId","buyerId","sellerId","currency","totalAmountMinor","status"::text AS "status","providerCheckoutId" FROM "MarketplaceOrder" WHERE "paymentProvider"='paypal' AND "providerCheckoutId"=$1 LIMIT 1`,paypalOrderId
 );
 return rows[0]??null;
}

async function finalizeCapture(input:{paypalOrderId:string;captureId:string;captureAmountMinor:number;currency:string}){
 const order=await findOrderByPayPalOrder(input.paypalOrderId);
 if(!order)return{matched:false};
 if(input.currency.toUpperCase()!==order.currency.toUpperCase()||input.captureAmountMinor!==order.totalAmountMinor)throw new Error("paypal_webhook_amount_mismatch");
 let captured=false,lateRefund=false,already=false;
 await prisma.$transaction(async tx=>{
  const o=(await tx.$queryRawUnsafe<Array<{status:string}>>(`SELECT "status"::text AS "status" FROM "MarketplaceOrder" WHERE "id"=$1 FOR UPDATE`,order.id))[0];
  const p=(await tx.$queryRawUnsafe<Array<{id:string;status:string;providerPaymentId:string|null}>>(`SELECT "id","status"::text AS "status","providerPaymentId" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "provider"='paypal' ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`,order.id))[0];
  if(!p)throw new Error("paypal_payment_missing");
  if(["CAPTURED","PARTIALLY_REFUNDED","REFUNDED"].includes(p.status)){already=true;return}
  const listing=(await tx.$queryRawUnsafe<Array<{status:string}>>(`SELECT "status"::text AS "status" FROM "Listing" WHERE "id"=$1 FOR UPDATE`,order.listingId))[0];
  if(o?.status==="PENDING_PAYMENT"&&listing?.status==="PUBLISHED"){
   captured=true;
   await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='PAID',"paidAt"=COALESCE("paidAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,order.id);
   await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CAPTURED',"providerPaymentId"=$2,"capturedAt"=COALESCE("capturedAt",CURRENT_TIMESTAMP),"failureCode"=NULL,"failureMessage"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,p.id,input.captureId);
   await tx.$executeRawUnsafe(`UPDATE "Listing" SET "status"='SOLD',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PUBLISHED'`,order.listingId);
  }else if(["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED","DISPUTED"].includes(o?.status??"")){
   captured=true;
   await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CAPTURED',"providerPaymentId"=$2,"capturedAt"=COALESCE("capturedAt",CURRENT_TIMESTAMP),"failureCode"=NULL,"failureMessage"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,p.id,input.captureId);
  }else{
   lateRefund=true;
   await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CAPTURED',"providerPaymentId"=$2,"capturedAt"=COALESCE("capturedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,p.id,input.captureId);
  }
 });
 if(lateRefund){
  const refund=await refundPayPalCapture(input.captureId,order.totalAmountMinor,order.currency,`paypal-webhook-late-refund-${order.id}`);
  const status=String(refund.status).toUpperCase()==="COMPLETED"?"SUCCEEDED":"PROCESSING";
  await prisma.$transaction(async tx=>{
   const p=(await tx.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "provider"='paypal' ORDER BY "createdAt" DESC LIMIT 1`,order.id))[0];
   if(!p)return;
   const refundId=randomUUID();
   await tx.$executeRawUnsafe(`INSERT INTO "MarketplaceRefund" ("id","orderId","paymentId","providerRefundId","amountMinor","currency","reason","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,'Paiement PayPal reçu après indisponibilité de l’annonce',$7::"RefundStatus",$8) ON CONFLICT ("providerRefundId") DO UPDATE SET "status"=EXCLUDED."status","updatedAt"=CURRENT_TIMESTAMP`,refundId,order.id,p.id,refund.id,order.totalAmountMinor,order.currency,status,`paypal-webhook-late-refund-${order.id}`);
   await tx.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") SELECT $1,$2,'REFUND',$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM "FinancialLedgerEntry" WHERE "reference"=$5)`,randomUUID(),order.id,-order.totalAmountMinor,order.currency,String(refund.id));
   await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='CANCELED',"canceledAt"=COALESCE("canceledAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PENDING_PAYMENT'`,order.id);
   if(status==="SUCCEEDED")await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='REFUNDED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,p.id);
  });
 }
 if(captured&&!already){
  const actionUrl=`/commandes/${order.id}`;
  await Promise.all([
   deliverUserEvent({userId:order.buyerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Paiement PayPal confirmé",body:`Le paiement de la commande ${order.orderNumber} est confirmé.`,actionUrl,transactional:true,dedupeKey:`paypal-webhook-paid:${order.id}:buyer`,metadata:{orderId:order.id,orderStatus:"PAID",paymentProvider:"paypal"}}),
   deliverUserEvent({userId:order.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Nouvelle vente",body:`La commande ${order.orderNumber} a été payée avec PayPal. Vous pouvez préparer l’envoi.`,actionUrl,transactional:true,dedupeKey:`paypal-webhook-paid:${order.id}:seller`,metadata:{orderId:order.id,orderStatus:"PAID",paymentProvider:"paypal"}}),
  ]).catch(()=>undefined);
 }
 return{matched:true,orderId:order.id,captured,lateRefund,already};
}

async function processRefund(resource:any,eventId:string){
 const captureId=String(resource?.supplementary_data?.related_ids?.capture_id??"");
 if(!captureId)return{matched:false};
 const payments=await prisma.$queryRawUnsafe<Array<{id:string;orderId:string;amountMinor:number;currency:string}>>(`SELECT "id","orderId","amountMinor","currency" FROM "MarketplacePayment" WHERE "provider"='paypal' AND "providerPaymentId"=$1 LIMIT 1`,captureId);
 const payment=payments[0];if(!payment)return{matched:false};
 const refundId=String(resource?.id??eventId);const refundAmount=amountMinor(resource?.amount?.value);const currency=String(resource?.amount?.currency_code??payment.currency).toUpperCase();
 if(refundAmount<=0||currency!==payment.currency.toUpperCase())throw new Error("paypal_refund_amount_invalid");
 const internalId=randomUUID();
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe(`INSERT INTO "MarketplaceRefund" ("id","orderId","paymentId","providerRefundId","amountMinor","currency","reason","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,'Confirmation PayPal webhook','SUCCEEDED',$7) ON CONFLICT ("providerRefundId") DO UPDATE SET "status"='SUCCEEDED',"updatedAt"=CURRENT_TIMESTAMP`,internalId,payment.orderId,payment.id,refundId,refundAmount,currency,`paypal-webhook-refund-${refundId}`);
  await tx.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") SELECT $1,$2,'REFUND',$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM "FinancialLedgerEntry" WHERE "reference"=$5)`,randomUUID(),payment.orderId,-refundAmount,currency,refundId);
  const sums=await tx.$queryRawUnsafe<Array<{refunded:bigint}>>(`SELECT COALESCE(SUM("amountMinor"),0)::bigint AS "refunded" FROM "MarketplaceRefund" WHERE "paymentId"=$1 AND "status"='SUCCEEDED'`,payment.id);
  const full=Number(sums[0]?.refunded??0n)>=payment.amountMinor;
  await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"=$1::"PaymentStatus","updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,full?"REFUNDED":"PARTIALLY_REFUNDED",payment.id);
  if(full)await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='REFUNDED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"<>'CANCELED'`,payment.orderId);
  await tx.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED')`,payment.orderId);
 });
 return{matched:true,orderId:payment.orderId,full:refundAmount>=payment.amountMinor};
}

async function processEvent(type:string,resource:any,eventId:string){
 if(type==="CHECKOUT.ORDER.APPROVED"){
  const paypalOrderId=String(resource?.id??"");if(!paypalOrderId)return{matched:false};
  const order=await findOrderByPayPalOrder(paypalOrderId);if(!order)return{matched:false};
  let remote=await getPayPalOrder(paypalOrderId);const unit=Array.isArray(remote?.purchase_units)?remote.purchase_units[0]:null;
  if(String(unit?.custom_id??unit?.reference_id??"")!==order.id)throw new Error("paypal_webhook_order_reference_mismatch");
  if(amountMinor(unit?.amount?.value)!==order.totalAmountMinor||String(unit?.amount?.currency_code??"").toUpperCase()!==order.currency.toUpperCase())throw new Error("paypal_webhook_amount_mismatch");
  if(String(remote?.status??"").toUpperCase()==="APPROVED")remote=await capturePayPalOrder(paypalOrderId,`paypal-webhook-capture-${order.id}`);
  const capture=paypalCaptureFromOrder(remote);if(!capture||capture.status.toUpperCase()!=="COMPLETED")throw new Error("paypal_webhook_capture_not_completed");
  return finalizeCapture({paypalOrderId,captureId:capture.id,captureAmountMinor:capture.amountMinor,currency:capture.currency});
 }
 if(type==="CHECKOUT.PAYMENT-APPROVAL.REVERSED"){
  const paypalOrderId=String(resource?.id??resource?.supplementary_data?.related_ids?.order_id??"");const order=paypalOrderId?await findOrderByPayPalOrder(paypalOrderId):null;if(!order)return{matched:false};
  await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='CANCELED',"failureCode"='PAYPAL_APPROVAL_REVERSED',"failureMessage"='Autorisation PayPal expirée ou annulée',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "provider"='paypal' AND "status" NOT IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')`,order.id);await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='CANCELED',"canceledAt"=COALESCE("canceledAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PENDING_PAYMENT'`,order.id)});return{matched:true,orderId:order.id};
 }
 if(type==="PAYMENT.CAPTURE.PENDING"){
  const paypalOrderId=String(resource?.supplementary_data?.related_ids?.order_id??"");const captureId=String(resource?.id??"");const order=paypalOrderId?await findOrderByPayPalOrder(paypalOrderId):null;if(!order)return{matched:false};
  const value=amountMinor(resource?.amount?.value),currency=String(resource?.amount?.currency_code??"").toUpperCase();if(value!==order.totalAmountMinor||currency!==order.currency.toUpperCase())throw new Error("paypal_pending_amount_mismatch");
  await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='AUTHORIZED',"providerPaymentId"=COALESCE("providerPaymentId",$2),"authorizedAt"=COALESCE("authorizedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "provider"='paypal' AND "status" NOT IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')`,order.id,captureId||null);return{matched:true,orderId:order.id,pending:true};
 }
 if(type==="PAYMENT.CAPTURE.COMPLETED"){
  const paypalOrderId=String(resource?.supplementary_data?.related_ids?.order_id??"");const captureId=String(resource?.id??"");
  if(!paypalOrderId||!captureId)return{matched:false};
  return finalizeCapture({paypalOrderId,captureId,captureAmountMinor:amountMinor(resource?.amount?.value),currency:String(resource?.amount?.currency_code??"")});
 }
 if(type==="PAYMENT.CAPTURE.REFUNDED")return processRefund(resource,eventId);
 if(type==="PAYMENT.CAPTURE.DENIED"){
  const paypalOrderId=String(resource?.supplementary_data?.related_ids?.order_id??"");const order=paypalOrderId?await findOrderByPayPalOrder(paypalOrderId):null;if(!order)return{matched:false};
  await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='FAILED',"failureCode"='PAYPAL_CAPTURE_DENIED',"failureMessage"='PayPal a refusé la capture',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "provider"='paypal' AND "status" NOT IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')`,order.id);await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='CANCELED',"canceledAt"=COALESCE("canceledAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='PENDING_PAYMENT'`,order.id)});return{matched:true,orderId:order.id};
 }
 if(type==="CUSTOMER.DISPUTE.CREATED"){
  const txns=Array.isArray(resource?.disputed_transactions)?resource.disputed_transactions:[];const captureId=String(txns[0]?.seller_transaction_id??txns[0]?.buyer_transaction_id??"");if(!captureId)return{matched:false};
  const payment=(await prisma.$queryRawUnsafe<Array<{orderId:string}>>(`SELECT "orderId" FROM "MarketplacePayment" WHERE "provider"='paypal' AND "providerPaymentId"=$1 LIMIT 1`,captureId))[0];if(!payment)return{matched:false};
  await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='DISPUTED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status" NOT IN ('CANCELED','REFUNDED')`,payment.orderId);await tx.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"failureReason"='PAYPAL_DISPUTE',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','PROCESSING','BLOCKED')`,payment.orderId)});return{matched:true,orderId:payment.orderId,externalDispute:true};
 }
 if(type==="PAYMENT.CAPTURE.REVERSED"){
  const captureId=String(resource?.id??resource?.supplementary_data?.related_ids?.capture_id??"");if(!captureId)return{matched:false};
  const payment=(await prisma.$queryRawUnsafe<Array<{id:string;orderId:string;amountMinor:number;currency:string}>>(`SELECT "id","orderId","amountMinor","currency" FROM "MarketplacePayment" WHERE "provider"='paypal' AND "providerPaymentId"=$1 LIMIT 1`,captureId))[0];if(!payment)return{matched:false};
  await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`UPDATE "MarketplacePayment" SET "status"='REFUNDED',"failureCode"='PAYPAL_CAPTURE_REVERSED',"failureMessage"='Capture PayPal annulée/inversée',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,payment.id);await tx.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='REFUNDED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,payment.orderId);await tx.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED')`,payment.orderId);await tx.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") SELECT $1,$2,'REFUND',$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM "FinancialLedgerEntry" WHERE "reference"=$5)`,randomUUID(),payment.orderId,-payment.amountMinor,payment.currency,`paypal-reversal-${eventId}`)});return{matched:true,orderId:payment.orderId};
 }
 return{ignored:true};
}

export async function registerPayPalWebhookRoutes(app:FastifyInstance){
 app.post("/payments/webhooks/paypal",{config:{rawBody:true}},async(request,reply)=>{
  const integration=await getRuntimeIntegration("paypal-checkout");const webhookId=String(integration?.config?.webhookId??"").trim();
  if(!integration?.enabled||!webhookId)return reply.code(503).send({error:"paypal_webhook_not_configured"});
  const event=request.body as any;const eventId=String(event?.id??"");const type=String(event?.event_type??"");if(!eventId||!type)return reply.code(400).send({error:"invalid_paypal_event"});
  const verified=await verifyPayPalWebhookSignature({webhookId,event,transmissionId:String(request.headers["paypal-transmission-id"]??""),transmissionTime:String(request.headers["paypal-transmission-time"]??""),transmissionSig:String(request.headers["paypal-transmission-sig"]??""),certUrl:String(request.headers["paypal-cert-url"]??""),authAlgo:String(request.headers["paypal-auth-algo"]??"")}).catch(()=>false);
  if(!verified)return reply.code(401).send({error:"invalid_paypal_signature"});
  await ensureAuditSchema();const raw=String((request as any).rawBody??JSON.stringify(event));const hash=eventHash(raw);
  await prisma.$executeRawUnsafe(`INSERT INTO "PaymentWebhookEvent" ("id","provider","providerEventId","eventType","payloadHash","attemptCount","lastAttemptAt") VALUES ($1,'paypal',$2,$3,$4,1,CURRENT_TIMESTAMP) ON CONFLICT ("provider","providerEventId") DO UPDATE SET "attemptCount"="PaymentWebhookEvent"."attemptCount"+1,"lastAttemptAt"=CURRENT_TIMESTAMP`,randomUUID(),eventId,type,hash);
  const prior=(await prisma.$queryRawUnsafe<Array<{processedAt:Date|null;payloadHash:string}>>(`SELECT "processedAt","payloadHash" FROM "PaymentWebhookEvent" WHERE "provider"='paypal' AND "providerEventId"=$1 LIMIT 1`,eventId))[0];
  if(prior?.processedAt)return reply.send({received:true,duplicate:true});
  try{const result=await processEvent(type,event?.resource??{},eventId);await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "processedAt"=CURRENT_TIMESTAMP,"lastError"=NULL WHERE "provider"='paypal' AND "providerEventId"=$1`,eventId);return reply.send({received:true,...result})}
  catch(error){const message=String(error instanceof Error?error.message:error).slice(0,500);await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "lastError"=$1,"lastAttemptAt"=CURRENT_TIMESTAMP WHERE "provider"='paypal' AND "providerEventId"=$2`,message,eventId).catch(()=>undefined);request.log.error({error,eventId,type},"paypal webhook processing failed");return reply.code(500).send({error:"paypal_webhook_processing_failed"})}
 });
}
