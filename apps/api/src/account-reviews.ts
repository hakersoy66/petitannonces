import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";

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
  const profiles=await prisma.$queryRawUnsafe<Array<{id:string;kind:string;createdAt:Date;displayName:string|null;firstName:string|null;avatarUrl:string|null;tradeName:string|null;legalName:string|null;verificationStatus:string|null;storeName:string|null;storeSlug:string|null;storeLogoUrl:string|null;storeVerified:boolean|null;activeListings:bigint}>>(`
    SELECT u."id",u."kind",u."createdAt",p."displayName",p."firstName",p."avatarUrl",b."tradeName",b."legalName",b."verificationStatus",
      s."name" AS "storeName",s."slug" AS "storeSlug",s."logoUrl" AS "storeLogoUrl",s."isVerified" AS "storeVerified",
      (SELECT COUNT(*) FROM "Listing" l WHERE l."sellerId"=u."id" AND l."status"='PUBLISHED')::bigint AS "activeListings"
    FROM "User" u
    LEFT JOIN "UserProfile" p ON p."userId"=u."id"
    LEFT JOIN "BusinessProfile" b ON b."userId"=u."id"
    LEFT JOIN LATERAL (SELECT "name","slug","logoUrl","isVerified" FROM "Store" WHERE "ownerId"=u."id" AND "status"='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1) s ON TRUE
    WHERE u."id"=$1 AND u."status"='ACTIVE' LIMIT 1`,p.data.id);
  const profile=profiles[0];if(!profile)return reply.code(404).send({error:"user_not_found"});
  const summary=await prisma.$queryRawUnsafe<Array<{count:bigint;average:number|null}>>(`SELECT COUNT(*)::bigint AS "count", AVG("rating")::float AS "average" FROM "MarketplaceReview" WHERE "revieweeId"=$1`,p.data.id);
  const rows=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT r."id",r."rating",r."comment",r."direction",r."createdAt",COALESCE(p."displayName",p."firstName",'Membre Petit Annonces') AS "reviewerName" FROM "MarketplaceReview" r LEFT JOIN "UserProfile" p ON p."userId"=r."reviewerId" WHERE r."revieweeId"=$1 ORDER BY r."createdAt" DESC LIMIT 20`,p.data.id);
  const name=profile.storeName??profile.tradeName??profile.displayName??profile.firstName??"Membre Petit Annonces";
  return reply.send({profile:{id:profile.id,kind:profile.kind,name,avatarUrl:profile.avatarUrl??profile.storeLogoUrl??null,memberSince:profile.createdAt,verified:profile.verificationStatus==="VERIFIED"||profile.storeVerified===true,store:profile.storeName?{name:profile.storeName,slug:profile.storeSlug}:null,activeListings:Number(profile.activeListings)},summary:{count:Number(summary[0]?.count??0n),average:summary[0]?.average??null},reviews:rows});
 });
}
