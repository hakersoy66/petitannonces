import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { deliverUserEvent } from "./notification-delivery.js";
import { ensureReturnWorkflowSchema } from "./return-workflow.js";
import { getSellerPayoutReadiness } from "./marketplace-payout-provider.js";

const SESSION_COOKIE = "pa_session";
function sha256(value:string){return createHash("sha256").update(value).digest("hex")}
async function requireUser(request:FastifyRequest, reply:FastifyReply){const authHeader=typeof request.headers.authorization==="string"?request.headers.authorization.trim():"";const bearer=/^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim()||null;const token=bearer??request.cookies[SESSION_COOKIE];if(!token){reply.code(401).send({error:"unauthorized"});return null}const session=await prisma.session.findUnique({where:{tokenHash:sha256(token)},include:{user:true}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"){reply.code(401).send({error:"unauthorized"});return null}return session.user}

type AccountOrderRow = Record<string, any> & { role: "BUYER" | "SELLER"; status?: string; disputeId?: string | null; disputeStatus?: string | null };

async function getAccountOrder(userId:string, orderId:string){
  const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`
    SELECT o.*, l."title", l."slug", l."city", l."sellerId",
      s."status" AS "shipmentStatus", s."carrier", s."service", s."trackingNumber", s."trackingUrl", s."labelUrl", s."estimatedDeliveryAt", s."shippedAt", s."deliveredAt", s."lastCarrierEventAt",
      bp."confirmationStatus" AS "protectionStatus", bp."endsAt" AS "protectionEndsAt", bp."payoutEligibleAt" AS "payoutEligibleAt",
      d."id" AS "disputeId", d."status" AS "disputeStatus", d."reason" AS "disputeReason", d."summary" AS "disputeSummary",
      p."status" AS "paymentStatus", p."providerPaymentId", p."capturedAt" AS "paymentCapturedAt", p."failureCode" AS "paymentFailureCode",
      rf."id" AS "refundId", rf."status" AS "refundStatus", rf."amountMinor" AS "refundAmountMinor", rf."updatedAt" AS "refundUpdatedAt",
      po."status" AS "payoutStatus", po."paidAt" AS "payoutPaidAt",
      cr."payoutGate" AS "riskPayoutGate", cr."payoutResolution" AS "riskPayoutResolution", cr."orderRiskScore" AS "orderRiskScore",
      rr."id" AS "returnRequestId", rr."status" AS "returnRequestStatus", rr."approvedAt" AS "returnApprovedAt", rr."returnCarrier", rr."returnTrackingNumber", rr."returnTrackingUrl", rr."returnShippedAt", rr."sellerReceivedAt", rr."sellerNotReceivedAt", rr."reason" AS "returnRequestReason", rr."details" AS "returnRequestDetails", rr."approvedAt" AS "returnApprovedAt", rr."returnCarrier", rr."returnTrackingNumber", rr."returnTrackingUrl", rr."returnShippedAt", rr."sellerReceivedAt", rr."sellerNotReceivedAt", rr."receiptNote",
      EXISTS(SELECT 1 FROM "MarketplaceRefund" rf WHERE rf."orderId"=o."id" AND rf."status" IN ('PENDING','PROCESSING')) AS "activeRefund",
      EXISTS(SELECT 1 FROM "MarketplacePayment" pr WHERE pr."orderId"=o."id" AND pr."status"='PARTIALLY_REFUNDED') AS "partialRefundReview",
      EXISTS(SELECT 1 FROM "MarketplaceSellerAccount" msa WHERE msa."userId"=o."sellerId" AND msa."onboardingStatus"='ACTIVE' AND msa."payoutsEnabled"=TRUE AND msa."detailsSubmitted"=TRUE) AS "sellerPaymentReady"
    FROM "MarketplaceOrder" o
    JOIN "Listing" l ON l."id"=o."listingId"
    LEFT JOIN "MarketplaceShipment" s ON s."orderId"=o."id"
    LEFT JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id"
    LEFT JOIN LATERAL (SELECT * FROM "MarketplaceDispute" md WHERE md."orderId"=o."id" ORDER BY md."createdAt" DESC LIMIT 1) d ON TRUE
    LEFT JOIN LATERAL (SELECT * FROM "MarketplacePayment" mp WHERE mp."orderId"=o."id" ORDER BY mp."createdAt" DESC LIMIT 1) p ON TRUE
    LEFT JOIN LATERAL (SELECT * FROM "MarketplaceRefund" mr WHERE mr."orderId"=o."id" ORDER BY mr."createdAt" DESC LIMIT 1) rf ON TRUE
    LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id"
    LEFT JOIN "MarketplaceOrderRiskReview" cr ON cr."orderId"=o."id"
    LEFT JOIN LATERAL (SELECT * FROM "MarketplaceReturnRequest" mr WHERE mr."orderId"=o."id" ORDER BY mr."createdAt" DESC LIMIT 1) rr ON TRUE
    WHERE o."id"=$1 AND (o."buyerId"=$2 OR o."sellerId"=$2) LIMIT 1`,orderId,userId);
  const row=rows[0]??null;
  if(!row)return null;
  const readiness=await getSellerPayoutReadiness(String(row.sellerId)).catch(()=>null);
  return {...(row as Record<string,any>),sellerPaymentReady:readiness?.sellerReady??false} as Record<string,any>;
}


function payoutState(o:Record<string,any>){
  if(String(o.status)==="DISPUTED")return "BLOCKED_DISPUTE";
  if(o.payoutStatus==="PAID")return "PAID";
  if(o.payoutStatus==="PROCESSING")return "PROCESSING";
  if(o.payoutStatus==="FAILED")return "FAILED";
  const activeDispute=Boolean(o.disputeId)&&!["RESOLVED_BUYER","RESOLVED_SELLER","CLOSED"].includes(String(o.disputeStatus));
  const activeReturn=Boolean(o.returnRequestId)&&["OPEN","APPROVED","PROCESSING"].includes(String(o.returnRequestStatus));
  if(activeDispute)return "BLOCKED_DISPUTE";
  if(activeReturn)return "BLOCKED_RETURN";
  if(Boolean(o.activeRefund))return "BLOCKED_REFUND";
  if(Boolean(o.partialRefundReview))return "BLOCKED_PARTIAL_REFUND";
  if(String(o.riskPayoutGate)==="HOLD"&&String(o.riskPayoutResolution)!=="APPROVED")return "BLOCKED_RISK_REVIEW";
  if(String(o.status)==="COMPLETED"&&String(o.shipmentStatus)!=="DELIVERED")return "BLOCKED_SHIPMENT";
  if(String(o.status)!=="COMPLETED")return "WAITING_COMPLETION";
  if(!Boolean(o.sellerPaymentReady))return "BANK_REQUIRED";
  if(!o.payoutEligibleAt)return "SCHEDULE_PENDING";
  return new Date(o.payoutEligibleAt).getTime()>Date.now()?"SCHEDULED":"READY";
}

export async function registerAccountOrderRoutes(app:FastifyInstance){
  await ensureReturnWorkflowSchema();
  app.get("/account/orders",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;
    const orders=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`
      SELECT o.*, l."title", l."slug", l."city",
        s."status" AS "shipmentStatus", s."carrier", s."trackingNumber", s."trackingUrl", s."estimatedDeliveryAt", s."shippedAt", s."deliveredAt", s."lastCarrierEventAt",
        bp."confirmationStatus" AS "protectionStatus", bp."endsAt" AS "protectionEndsAt", bp."payoutEligibleAt" AS "payoutEligibleAt",
        d."id" AS "disputeId", d."status" AS "disputeStatus", d."reason" AS "disputeReason",
        p."status" AS "paymentStatus", p."providerPaymentId", p."capturedAt" AS "paymentCapturedAt", p."failureCode" AS "paymentFailureCode",
        rf."id" AS "refundId", rf."status" AS "refundStatus", rf."amountMinor" AS "refundAmountMinor", rf."updatedAt" AS "refundUpdatedAt",
        po."status" AS "payoutStatus", po."paidAt" AS "payoutPaidAt",
      cr."payoutGate" AS "riskPayoutGate", cr."payoutResolution" AS "riskPayoutResolution", cr."orderRiskScore" AS "orderRiskScore",
        rr."id" AS "returnRequestId", rr."status" AS "returnRequestStatus", rr."approvedAt" AS "returnApprovedAt", rr."returnCarrier", rr."returnTrackingNumber", rr."returnTrackingUrl", rr."returnShippedAt", rr."sellerReceivedAt", rr."sellerNotReceivedAt",
        EXISTS(SELECT 1 FROM "MarketplaceRefund" rf WHERE rf."orderId"=o."id" AND rf."status" IN ('PENDING','PROCESSING')) AS "activeRefund",
      EXISTS(SELECT 1 FROM "MarketplacePayment" pr WHERE pr."orderId"=o."id" AND pr."status"='PARTIALLY_REFUNDED') AS "partialRefundReview",
        EXISTS(SELECT 1 FROM "MarketplaceSellerAccount" msa WHERE msa."userId"=o."sellerId" AND msa."onboardingStatus"='ACTIVE' AND msa."payoutsEnabled"=TRUE AND msa."detailsSubmitted"=TRUE) AS "sellerPaymentReady"
      FROM "MarketplaceOrder" o
      JOIN "Listing" l ON l."id"=o."listingId"
      LEFT JOIN "MarketplaceShipment" s ON s."orderId"=o."id"
      LEFT JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id"
      LEFT JOIN LATERAL (SELECT * FROM "MarketplaceDispute" md WHERE md."orderId"=o."id" ORDER BY md."createdAt" DESC LIMIT 1) d ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM "MarketplacePayment" mp WHERE mp."orderId"=o."id" ORDER BY mp."createdAt" DESC LIMIT 1) p ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM "MarketplaceRefund" mr WHERE mr."orderId"=o."id" ORDER BY mr."createdAt" DESC LIMIT 1) rf ON TRUE
      LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id"
    LEFT JOIN "MarketplaceOrderRiskReview" cr ON cr."orderId"=o."id"
      LEFT JOIN LATERAL (SELECT * FROM "MarketplaceReturnRequest" mr WHERE mr."orderId"=o."id" ORDER BY mr."createdAt" DESC LIMIT 1) rr ON TRUE
      WHERE (o."buyerId"=$1 OR o."sellerId"=$1)
        AND o."status" NOT IN ('PENDING_PAYMENT','CANCELED')
      ORDER BY o."updatedAt" DESC LIMIT 100`,user.id);
    const ownSellerReadiness=orders.some(o=>o.sellerId===user.id)?await getSellerPayoutReadiness(user.id).catch(()=>null):null;
    const mapped:AccountOrderRow[]=orders.map(o=>{const sellerPaymentReady=o.sellerId===user.id?(ownSellerReadiness?.sellerReady??false):true;const base:Record<string,any>={...(o as Record<string,any>),sellerPaymentReady};return{...base,role:o.buyerId===user.id?"BUYER":"SELLER",payoutState:payoutState(base)} as AccountOrderRow});
    return reply.send({orders:mapped,summary:{purchases:mapped.filter(o=>o.role==="BUYER").length,sales:mapped.filter(o=>o.role==="SELLER").length,active:mapped.filter(o=>!["COMPLETED","CANCELED","REFUNDED"].includes(String(o.status))).length,disputes:mapped.filter(o=>o.disputeId&&!["RESOLVED_BUYER","RESOLVED_SELLER","CLOSED"].includes(String(o.disputeStatus))).length}})
  });

  app.get("/account/orders/:id",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_order"});const order=await getAccountOrder(user.id,params.data.id);if(!order)return reply.code(404).send({error:"order_not_found"});return reply.send({order:{...order,role:order.buyerId===user.id?"BUYER":"SELLER",payoutState:payoutState(order)}})});

  app.post("/account/orders/:id/return-request",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({reason:z.string().trim().min(3).max(120),details:z.string().trim().min(10).max(2000)}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const order=await getAccountOrder(user.id,params.data.id);if(!order)return reply.code(404).send({error:"order_not_found"});if(order.buyerId!==user.id)return reply.code(403).send({error:"buyer_only"});if(String(order.status)!=="DELIVERED"||String(order.shipmentStatus)!=="DELIVERED")return reply.code(409).send({error:"return_request_not_available"});if(!order.protectionEndsAt||String(order.protectionStatus)!=="WAITING"||new Date(order.protectionEndsAt).getTime()<=Date.now())return reply.code(409).send({error:"buyer_protection_expired"});try{const id=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceReturnRequest" ("id","orderId","requestedById","reason","details") VALUES ($1,$2,$3,$4,$5)`,id,order.id,user.id,body.data.reason,body.data.details);await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','PROCESSING')`,order.id);await deliverUserEvent({userId:String(order.sellerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:"Demande de retour reçue",body:`Une demande de retour a été ouverte pour la commande ${order.orderNumber}. Le versement reste bloqué pendant l’examen.`,actionUrl:`/commandes/${order.id}`,transactional:true,metadata:{orderId:order.id,returnRequestId:id}}).catch(()=>undefined);return reply.code(201).send({returnRequest:{id,status:"OPEN"}})}catch(error){if(String(error).includes("MarketplaceReturnRequest_active_order_idx"))return reply.code(409).send({error:"active_return_request_exists"});throw error}});

  app.post("/account/orders/:id/return-shipment",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({carrier:z.string().trim().min(2).max(80),trackingNumber:z.string().trim().min(3).max(140),trackingUrl:z.string().url().max(1000).optional()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const order=await getAccountOrder(user.id,params.data.id);if(!order)return reply.code(404).send({error:"order_not_found"});if(order.buyerId!==user.id)return reply.code(403).send({error:"buyer_only"});
    if(!order.returnRequestId||!["APPROVED","PROCESSING"].includes(String(order.returnRequestStatus)))return reply.code(409).send({error:"return_not_approved"});
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceReturnRequest" SET "status"='PROCESSING',"returnCarrier"=$1,"returnTrackingNumber"=$2,"returnTrackingUrl"=$3,"returnShippedAt"=COALESCE("returnShippedAt",CURRENT_TIMESTAMP),"sellerNotReceivedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4`,body.data.carrier,body.data.trackingNumber,body.data.trackingUrl??null,order.returnRequestId);
    await deliverUserEvent({userId:String(order.sellerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:"Retour expédié",body:`L’acheteur a expédié le retour de la commande ${order.orderNumber}.`,actionUrl:`/commandes/${order.id}`,transactional:true,metadata:{orderId:order.id,returnRequestId:order.returnRequestId}}).catch(()=>undefined);
    return reply.send({saved:true,status:"PROCESSING"});
  });

  app.post("/account/orders/:id/return-receipt",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({received:z.boolean(),note:z.string().trim().max(1000).optional()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const order=await getAccountOrder(user.id,params.data.id);if(!order)return reply.code(404).send({error:"order_not_found"});if(order.sellerId!==user.id)return reply.code(403).send({error:"seller_only"});
    if(!order.returnRequestId||String(order.returnRequestStatus)!=="PROCESSING")return reply.code(409).send({error:"return_not_in_transit"});
    if(body.data.received)await prisma.$executeRawUnsafe(`UPDATE "MarketplaceReturnRequest" SET "sellerReceivedAt"=CURRENT_TIMESTAMP,"sellerNotReceivedAt"=NULL,"receiptNote"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,body.data.note??null,order.returnRequestId);
    else await prisma.$executeRawUnsafe(`UPDATE "MarketplaceReturnRequest" SET "sellerNotReceivedAt"=CURRENT_TIMESTAMP,"sellerReceivedAt"=NULL,"receiptNote"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,body.data.note??null,order.returnRequestId);
    await deliverUserEvent({userId:String(order.buyerId),eventKind:"LISTING",notificationKind:"SYSTEM",title:body.data.received?"Retour reçu par le vendeur":"Retour signalé comme non reçu",body:body.data.received?`Le vendeur a confirmé la réception du retour ${order.orderNumber}.`:`Le vendeur indique ne pas avoir reçu le retour ${order.orderNumber}. Le dossier reste en examen.`,actionUrl:`/commandes/${order.id}`,transactional:true,metadata:{orderId:order.id,returnRequestId:order.returnRequestId}}).catch(()=>undefined);
    return reply.send({saved:true,received:body.data.received});
  });
}
