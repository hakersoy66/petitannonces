import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { assessUserRisk } from "./risk-engine.js";
import { requireAdminRoles } from "./rbac.js";

const SESSION_COOKIE="pa_session";
const VIEW_ROLES=["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","COMPLIANCE","FINANCE"] as const;
const ACTION_ROLES=["SUPER_ADMIN","ADMIN","MODERATOR","COMPLIANCE","FINANCE"] as const;
const HIGH_VALUE_MINOR=Math.max(10000,Number(process.env.COMMERCE_RISK_HIGH_VALUE_MINOR??50000));

type Gate="CLEAR"|"REVIEW";
type PayoutGate="CLEAR"|"HOLD";
type Resolution="APPROVED"|"REJECTED"|null;
type Signal={code:string;weight:number;detail:string};
function sha256(value:string){return createHash("sha256").update(value).digest("hex")}
function clamp(value:number){return Math.min(100,Math.max(0,Math.round(value)))}
function add(signals:Signal[],code:string,weight:number,detail:string){signals.push({code,weight,detail})}
function canPreserve(existing:any,buyerScore:number,sellerScore:number){return Boolean(existing&&buyerScore<=Number(existing.buyerRiskScore??0)&&sellerScore<=Number(existing.sellerRiskScore??0))}

export async function snapshotOrderCommerceRisk(orderId:string){
  const orders=await prisma.$queryRawUnsafe<Array<{id:string;buyerId:string;sellerId:string;totalAmountMinor:number;sellerNetMinor:number;status:string;payoutPaid:boolean}>>(`SELECT o."id",o."buyerId",o."sellerId",o."totalAmountMinor",o."sellerNetMinor",o."status"::text AS "status",EXISTS(SELECT 1 FROM "MarketplacePayout" po WHERE po."orderId"=o."id" AND po."status"='PAID') AS "payoutPaid" FROM "MarketplaceOrder" o WHERE o."id"=$1 LIMIT 1`,orderId);
  const order=orders[0];if(!order)return null;
  const [buyer,seller,sales,existingRows]=await Promise.all([
    assessUserRisk(order.buyerId),
    assessUserRisk(order.sellerId),
    prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "MarketplaceOrder" WHERE "sellerId"=$1 AND "status"='COMPLETED'`,order.sellerId),
    prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT * FROM "MarketplaceOrderRiskReview" WHERE "orderId"=$1 LIMIT 1`,order.id),
  ]);
  if(!buyer||!seller)return null;
  const sellerCompletedSales=Number(sales[0]?.count??0n);
  const newSeller=sellerCompletedSales<3;
  const highValue=Number(order.totalAmountMinor)>=HIGH_VALUE_MINOR;
  const signals:Signal[]=[];
  if(seller.level==="CRITICAL")add(signals,"SELLER_CRITICAL",45,"Risque vendeur critique");
  else if(seller.level==="HIGH")add(signals,"SELLER_HIGH",30,"Risque vendeur élevé");
  else if(seller.level==="MEDIUM")add(signals,"SELLER_MEDIUM",10,"Risque vendeur moyen");
  if(buyer.level==="CRITICAL")add(signals,"BUYER_CRITICAL",30,"Risque acheteur critique");
  else if(buyer.level==="HIGH")add(signals,"BUYER_HIGH",12,"Risque acheteur élevé");
  if(seller.commerceReviewRequired)add(signals,"SELLER_COMMERCE_REVIEW",15,"Vérification commerce vendeur requise");
  if(buyer.commerceReviewRequired)add(signals,"BUYER_COMMERCE_REVIEW",8,"Vérification commerce acheteur requise");
  if(seller.hardEvents24>0)add(signals,"SELLER_HARD_EVENTS",Math.min(20,seller.hardEvents24*7),"Signaux antifraude vendeur récents");
  if(buyer.hardEvents24>0)add(signals,"BUYER_HARD_EVENTS",Math.min(14,buyer.hardEvents24*5),"Signaux antifraude acheteur récents");
  if(newSeller&&highValue)add(signals,"NEW_SELLER_HIGH_VALUE",20,"Nouvel historique vendeur sur une commande à valeur élevée");
  const orderRiskScore=clamp(Math.max(buyer.score,seller.score)+signals.reduce((sum,s)=>sum+s.weight,0)/3);
  const paymentRisk=seller.level==="CRITICAL"||buyer.level==="CRITICAL"||(seller.level==="HIGH"&&seller.hardEvents24>0)||(buyer.level==="HIGH"&&buyer.hardEvents24>0);
  const paymentGate:Gate=order.status==="PENDING_PAYMENT"&&paymentRisk?"REVIEW":"CLEAR";
  const payoutRisk=seller.level==="HIGH"||seller.level==="CRITICAL"||seller.commerceReviewRequired||seller.hardEvents24>0||(newSeller&&highValue);
  const payoutApplicable=!order.payoutPaid&&!['CANCELED','REFUNDED'].includes(order.status);
  const payoutGate:PayoutGate=payoutApplicable&&payoutRisk?"HOLD":"CLEAR";
  const existing=existingRows[0]??null;
  const preserve=canPreserve(existing,buyer.score,seller.score);
  const paymentResolution:Resolution=paymentGate==="CLEAR"?null:(preserve?(existing?.paymentResolution??null):null);
  const payoutResolution:Resolution=payoutGate==="CLEAR"?null:(preserve?(existing?.payoutResolution??null):null);
  const id=String(existing?.id??randomUUID());
  await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceOrderRiskReview" ("id","orderId","buyerId","sellerId","buyerRiskScore","sellerRiskScore","orderRiskScore","buyerRiskLevel","sellerRiskLevel","signals","paymentGate","paymentResolution","payoutGate","payoutResolution","sellerCompletedSales","newSeller","highValue","assessedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::"FraudRiskLevel",$9::"FraudRiskLevel",$10::jsonb,$11,$12,$13,$14,$15,$16,$17,CURRENT_TIMESTAMP) ON CONFLICT ("orderId") DO UPDATE SET "buyerRiskScore"=EXCLUDED."buyerRiskScore","sellerRiskScore"=EXCLUDED."sellerRiskScore","orderRiskScore"=EXCLUDED."orderRiskScore","buyerRiskLevel"=EXCLUDED."buyerRiskLevel","sellerRiskLevel"=EXCLUDED."sellerRiskLevel","signals"=EXCLUDED."signals","paymentGate"=EXCLUDED."paymentGate","paymentResolution"=EXCLUDED."paymentResolution","payoutGate"=EXCLUDED."payoutGate","payoutResolution"=EXCLUDED."payoutResolution","sellerCompletedSales"=EXCLUDED."sellerCompletedSales","newSeller"=EXCLUDED."newSeller","highValue"=EXCLUDED."highValue","assessedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP`,id,order.id,order.buyerId,order.sellerId,buyer.score,seller.score,orderRiskScore,buyer.level,seller.level,JSON.stringify(signals),paymentGate,paymentResolution,payoutGate,payoutResolution,sellerCompletedSales,newSeller,highValue);
  return{orderId:order.id,buyerRiskScore:buyer.score,sellerRiskScore:seller.score,orderRiskScore,buyerRiskLevel:buyer.level,sellerRiskLevel:seller.level,signals,paymentGate,paymentResolution,payoutGate,payoutResolution,newSeller,highValue,sellerCompletedSales};
}

export async function commercePaymentGate(orderId:string){
  const risk=await snapshotOrderCommerceRisk(orderId);if(!risk)return{allowed:false,error:"commerce_risk_unavailable",risk:null};
  if(risk.paymentGate==="CLEAR")return{allowed:true,error:null,risk};
  if(risk.paymentResolution==="APPROVED")return{allowed:true,error:null,risk};
  if(risk.paymentResolution==="REJECTED")return{allowed:false,error:"commerce_review_rejected",risk};
  return{allowed:false,error:"commerce_review_required",risk};
}

export async function commercePayoutGate(orderId:string){
  const risk=await snapshotOrderCommerceRisk(orderId);if(!risk)return{allowed:false,error:"RISK_REVIEW_REQUIRED",risk:null};
  if(risk.payoutGate==="CLEAR")return{allowed:true,error:null,risk};
  if(risk.payoutResolution==="APPROVED")return{allowed:true,error:null,risk};
  if(risk.payoutResolution==="REJECTED")return{allowed:false,error:"RISK_REVIEW_REJECTED",risk};
  return{allowed:false,error:"RISK_REVIEW_REQUIRED",risk};
}

async function actorId(request:FastifyRequest){const token=request.cookies[SESSION_COOKIE];if(!token)return null;const session=await prisma.session.findUnique({where:{tokenHash:sha256(token)},select:{userId:true,revokedAt:true,expiresAt:true}});return session&&!session.revokedAt&&session.expiresAt>new Date()?session.userId:null}
async function audit(request:FastifyRequest,action:string,orderId:string,metadata?:unknown){const actor=await actorId(request);if(!actor)return;await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,'ORDER_RISK',$4,$5::jsonb)`,randomUUID(),actor,action,orderId,JSON.stringify(metadata??{})).catch(()=>undefined)}

export async function registerCommerceRiskRoutes(app:FastifyInstance){
  app.get("/admin/risk/orders",{preHandler:requireAdminRoles([...VIEW_ROLES])},async(request,reply)=>{
    const q=z.object({state:z.enum(["all","payment","payout"]).default("all"),limit:z.coerce.number().int().min(10).max(200).default(100)}).safeParse(request.query);if(!q.success)return reply.code(400).send({error:"invalid_request"});
    const items=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT r.*,o."orderNumber",o."status"::text AS "orderStatus",o."totalAmountMinor",o."sellerNetMinor",o."currency",o."createdAt" AS "orderCreatedAt",COALESCE(bp."displayName",bu."email") AS "buyerName",bu."email" AS "buyerEmail",COALESCE(sp."displayName",su."email") AS "sellerName",su."email" AS "sellerEmail" FROM "MarketplaceOrderRiskReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" JOIN "User" bu ON bu."id"=r."buyerId" JOIN "User" su ON su."id"=r."sellerId" LEFT JOIN "UserProfile" bp ON bp."userId"=bu."id" LEFT JOIN "UserProfile" sp ON sp."userId"=su."id" WHERE ($1='all' OR ($1='payment' AND r."paymentGate"='REVIEW' AND r."paymentResolution" IS NULL) OR ($1='payout' AND r."payoutGate"='HOLD' AND r."payoutResolution" IS NULL)) ORDER BY CASE WHEN r."paymentGate"='REVIEW' AND r."paymentResolution" IS NULL THEN 0 WHEN r."payoutGate"='HOLD' AND r."payoutResolution" IS NULL THEN 1 ELSE 2 END,r."orderRiskScore" DESC,r."updatedAt" DESC LIMIT $2`,q.data.state,q.data.limit);
    const summary=await prisma.$queryRawUnsafe<Array<{payment:bigint;payout:bigint;rejected:bigint}>>(`SELECT COUNT(*) FILTER(WHERE "paymentGate"='REVIEW' AND "paymentResolution" IS NULL)::bigint AS payment,COUNT(*) FILTER(WHERE "payoutGate"='HOLD' AND "payoutResolution" IS NULL)::bigint AS payout,COUNT(*) FILTER(WHERE "paymentResolution"='REJECTED' OR "payoutResolution"='REJECTED')::bigint AS rejected FROM "MarketplaceOrderRiskReview"`);
    return reply.send({items,summary:{payment:Number(summary[0]?.payment??0n),payout:Number(summary[0]?.payout??0n),rejected:Number(summary[0]?.rejected??0n)}});
  });
  app.post("/admin/risk/orders/:id/payment-review",{preHandler:requireAdminRoles([...ACTION_ROLES])},async(request,reply)=>{
    const p=z.object({id:z.string().min(1)}).safeParse(request.params);const b=z.object({action:z.enum(["APPROVE","REJECT"]),note:z.string().trim().max(1000).optional()}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const actor=await actorId(request);if(!actor)return reply.code(401).send({error:"unauthenticated"});
    const rows=await prisma.$queryRawUnsafe<Array<{orderId:string}>>(`UPDATE "MarketplaceOrderRiskReview" SET "paymentResolution"=$2,"paymentReviewedByUserId"=$3,"paymentReviewedAt"=CURRENT_TIMESTAMP,"reviewNote"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "paymentGate"='REVIEW' RETURNING "orderId"`,p.data.id,b.data.action==="APPROVE"?"APPROVED":"REJECTED",actor,b.data.note??null);if(!rows[0])return reply.code(409).send({error:"payment_review_not_required"});await audit(request,b.data.action==="APPROVE"?"ORDER_PAYMENT_RISK_APPROVED":"ORDER_PAYMENT_RISK_REJECTED",p.data.id,{note:b.data.note});return reply.send({orderId:p.data.id,resolution:b.data.action==="APPROVE"?"APPROVED":"REJECTED"});
  });
  app.post("/admin/risk/orders/:id/payout-review",{preHandler:requireAdminRoles([...ACTION_ROLES])},async(request,reply)=>{
    const p=z.object({id:z.string().min(1)}).safeParse(request.params);const b=z.object({action:z.enum(["APPROVE","REJECT"]),note:z.string().trim().max(1000).optional()}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const actor=await actorId(request);if(!actor)return reply.code(401).send({error:"unauthenticated"});
    const resolution=b.data.action==="APPROVE"?"APPROVED":"REJECTED";const rows=await prisma.$queryRawUnsafe<Array<{orderId:string}>>(`UPDATE "MarketplaceOrderRiskReview" SET "payoutResolution"=$2,"payoutReviewedByUserId"=$3,"payoutReviewedAt"=CURRENT_TIMESTAMP,"reviewNote"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "payoutGate"='HOLD' RETURNING "orderId"`,p.data.id,resolution,actor,b.data.note??null);if(!rows[0])return reply.code(409).send({error:"payout_review_not_required"});if(resolution==="APPROVED")await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='PENDING',"failureReason"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status"='BLOCKED' AND "failureReason" IN ('RISK_REVIEW_REQUIRED','RISK_REVIEW_REJECTED')`,p.data.id).catch(()=>undefined);else await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"failureReason"='RISK_REVIEW_REJECTED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED','FAILED')`,p.data.id).catch(()=>undefined);await audit(request,b.data.action==="APPROVE"?"ORDER_PAYOUT_RISK_APPROVED":"ORDER_PAYOUT_RISK_REJECTED",p.data.id,{note:b.data.note});return reply.send({orderId:p.data.id,resolution});
  });
}