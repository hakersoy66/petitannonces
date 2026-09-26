import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { calculateTrustScore } from "./trust-score.js";
import { getReputationBadgeHistory, getUserReputation } from "./reputation.js";

type OrderRow={id:string;buyerId:string;sellerId:string;status:string};

export async function registerAccountReviewRoutes(app:FastifyInstance){
 app.get("/account/orders/:id/review",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;
  const p=z.object({id:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_order"});
  const orders=await prisma.$queryRawUnsafe<OrderRow[]>(`SELECT "id","buyerId","sellerId","status" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,p.data.id);const order=orders[0];
  if(!order)return reply.code(404).send({error:"order_not_found"});if(order.buyerId!==user.id&&order.sellerId!==user.id)return reply.code(403).send({error:"forbidden"});
  const rows=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","rating","comment","direction","createdAt" FROM "MarketplaceReview" WHERE "orderId"=$1 AND "reviewerId"=$2 LIMIT 1`,order.id,user.id);
  return reply.send({review:rows[0]??null,eligible:order.status==="COMPLETED"});
 });

 app.post("/account/orders/:id/review",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;
  const p=z.object({id:z.string().min(1)}).safeParse(request.params);
  const b=z.object({rating:z.number().int().min(1).max(5),comment:z.string().trim().max(1000).optional().nullable()}).safeParse(request.body);
  if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});
  const orders=await prisma.$queryRawUnsafe<OrderRow[]>(`SELECT "id","buyerId","sellerId","status" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`,p.data.id);const order=orders[0];
  if(!order)return reply.code(404).send({error:"order_not_found"});if(order.buyerId!==user.id&&order.sellerId!==user.id)return reply.code(403).send({error:"forbidden"});if(order.status!=="COMPLETED")return reply.code(409).send({error:"order_not_completed"});
  const direction=user.id===order.buyerId?"BUYER_TO_SELLER":"SELLER_TO_BUYER";const revieweeId=user.id===order.buyerId?order.sellerId:order.buyerId;
  try{await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceReview" ("id","orderId","reviewerId","revieweeId","direction","rating","comment") VALUES ($1,$2,$3,$4,$5::"MarketplaceReviewDirection",$6,$7)`,randomUUID(),order.id,user.id,revieweeId,direction,b.data.rating,b.data.comment||null);}catch(error){if(String(error).toLowerCase().includes("unique"))return reply.code(409).send({error:"review_already_submitted"});throw error;}
  await prisma.$executeRawUnsafe(`INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata") VALUES ($1,$2,'SYSTEM',$3,$4,$5,$6::jsonb)`,randomUUID(),revieweeId,"Nouvelle évaluation reçue",`Vous avez reçu une évaluation de ${b.data.rating}/5 après une transaction.`,`/mon-compte/profil`,JSON.stringify({orderId:order.id,rating:b.data.rating}));
  return reply.code(201).send({created:true});
 });

 app.get("/public/users/:id/reviews",async(request,reply)=>{
  const p=z.object({id:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_user"});
  const profiles=await prisma.$queryRawUnsafe<Array<{id:string;kind:string;createdAt:Date;emailVerifiedAt:Date|null;phoneVerifiedAt:Date|null;displayName:string|null;firstName:string|null;avatarUrl:string|null;tradeName:string|null;legalName:string|null;verificationStatus:string|null;siret:string|null;storeName:string|null;storeSlug:string|null;storeLogoUrl:string|null;storeVerified:boolean|null;activeListings:bigint}>>(`
    SELECT u."id",u."kind",u."createdAt",u."emailVerifiedAt",p."phoneVerifiedAt",p."displayName",p."firstName",p."avatarUrl",b."tradeName",b."legalName",b."verificationStatus",b."siret",
      s."name" AS "storeName",s."slug" AS "storeSlug",s."logoUrl" AS "storeLogoUrl",s."isVerified" AS "storeVerified",
      (SELECT COUNT(*) FROM "Listing" l WHERE l."sellerId"=u."id" AND l."status"='PUBLISHED')::bigint AS "activeListings"
    FROM "User" u
    LEFT JOIN "UserProfile" p ON p."userId"=u."id"
    LEFT JOIN "BusinessProfile" b ON b."userId"=u."id"
    LEFT JOIN LATERAL (SELECT "name","slug","logoUrl","isVerified" FROM "Store" WHERE "ownerId"=u."id" AND "status"='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1) s ON TRUE
    WHERE u."id"=$1 AND u."status"='ACTIVE' LIMIT 1`,p.data.id);
  const profile=profiles[0];if(!profile)return reply.code(404).send({error:"user_not_found"});
  const [summary,completedRows,rows,directionRows,listingRows]=await Promise.all([
    prisma.$queryRawUnsafe<Array<{count:bigint;average:number|null}>>(`SELECT COUNT(*)::bigint AS "count", AVG(r."rating")::float AS "average" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' WHERE r."revieweeId"=$1`,p.data.id),
    prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "MarketplaceOrder" WHERE "sellerId"=$1 AND "status"='COMPLETED'`,p.data.id),
    prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT r."id",r."rating",r."comment",r."direction",r."createdAt",COALESCE(p."displayName",p."firstName",'Membre Petit Annonces') AS "reviewerName" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' LEFT JOIN "UserProfile" p ON p."userId"=r."reviewerId" WHERE r."revieweeId"=$1 ORDER BY r."createdAt" DESC LIMIT 20`,p.data.id),
    prisma.$queryRawUnsafe<Array<{direction:string;count:bigint;average:number|null}>>(`SELECT r."direction"::text AS direction,COUNT(*)::bigint AS count,AVG(r."rating")::float AS average FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' WHERE r."revieweeId"=$1 GROUP BY r."direction"`,p.data.id),
    prisma.$queryRawUnsafe<Array<{id:string;title:string|null;slug:string|null;priceMinor:number|null;currency:string;city:string|null;categoryName:string;categoryDomain:string;transactionType:string|null;imageUrl:string|null;publishedAt:Date|null}>>(`SELECT l."id",l."title",l."slug",l."priceMinor",l."currency",l."city",c."name" AS "categoryName",c."domain"::text AS "categoryDomain",pd."transactionType"::text AS "transactionType",l."publishedAt",(SELECT 'https://petitannonces.fr/api/media/watermark/' || lm."id" FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL ORDER BY lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC LIMIT 1) AS "imageUrl" FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId" LEFT JOIN "PropertyDetails" pd ON pd."listingId"=l."id" WHERE l."sellerId"=$1 AND l."status"='PUBLISHED' ORDER BY l."publishedAt" DESC LIMIT 12`,p.data.id)
  ]);
  const siretVerified=profile.verificationStatus==="VERIFIED"&&Boolean(profile.siret);const verified=siretVerified||profile.storeVerified===true;
  const reviewCount=Number(summary[0]?.count??0n);const reviewAverage=summary[0]?.average??null;const completedSales=Number(completedRows[0]?.count??0n);
  const emailVerified=Boolean(profile.emailVerifiedAt);const phoneVerified=Boolean(profile.phoneVerifiedAt);const trust=calculateTrustScore({verified,emailVerified,reviewCount,reviewAverage,completedSales,memberSince:profile.createdAt});
  const name=profile.storeName??profile.tradeName??profile.displayName??profile.firstName??"Membre Petit Annonces";
  const directionMap=new Map(directionRows.map(r=>[r.direction,r] as const));const sellerAggregate=directionMap.get("BUYER_TO_SELLER"),buyerAggregate=directionMap.get("SELLER_TO_BUYER");
  const sellerSummary={count:Number(sellerAggregate?.count??0n),average:sellerAggregate?.average??null};
  const buyerSummary={count:Number(buyerAggregate?.count??0n),average:buyerAggregate?.average??null};
  const [reputation,reputationHistory]=await Promise.all([getUserReputation(profile.id),getReputationBadgeHistory(profile.id,20)]);
  const reputationPayload=reputation?{...reputation,history:reputationHistory}:null;
  return reply.send({profile:{id:profile.id,kind:profile.kind,name,avatarUrl:profile.avatarUrl??profile.storeLogoUrl??null,memberSince:profile.createdAt,verified,siretVerified,emailVerified,phoneVerified,store:profile.storeName?{name:profile.storeName,slug:profile.storeSlug}:null,activeListings:Number(profile.activeListings),completedSales,trust:reputation?.trust??trust,reputation:reputationPayload},summary:{count:reviewCount,average:reviewAverage,seller:sellerSummary,buyer:buyerSummary},reviews:rows,listings:listingRows});
 });
}
