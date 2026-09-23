import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { deliverUserEvent } from "./notification-delivery.js";

const followTargetSchema=z.object({targetType:z.enum(["USER","STORE"]),targetId:z.string().min(1).max(120),sourceListingId:z.string().min(1).max(120).optional()});

type FollowTarget="USER"|"STORE";
type TargetInfo={targetType:FollowTarget;targetId:string;ownerId:string;name:string};

export async function ensureFollowingSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "FollowSubscription" (
    "id" TEXT PRIMARY KEY,
    "followerUserId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowSubscription_followerUserId_fkey" FOREIGN KEY ("followerUserId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "FollowSubscription_targetType_check" CHECK ("targetType" IN ('USER','STORE')),
    CONSTRAINT "FollowSubscription_follower_target_key" UNIQUE ("followerUserId","targetType","targetId")
  )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "FollowSubscription" ADD COLUMN IF NOT EXISTS "sourceListingId" TEXT`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FollowSubscription_target_idx" ON "FollowSubscription" ("targetType","targetId","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FollowSubscription_follower_idx" ON "FollowSubscription" ("followerUserId","createdAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "FollowSubscription_source_listing_idx" ON "FollowSubscription" ("sourceListingId","createdAt") WHERE "sourceListingId" IS NOT NULL`);
}

async function targetInfo(targetType:FollowTarget,targetId:string):Promise<TargetInfo|null>{
  if(targetType==="USER"){
    const rows=await prisma.$queryRawUnsafe<Array<{id:string;name:string}>>(`SELECT u."id",COALESCE(s."name",b."tradeName",p."displayName",p."firstName",'Membre Petit Annonces') AS "name" FROM "User" u LEFT JOIN "UserProfile" p ON p."userId"=u."id" LEFT JOIN "BusinessProfile" b ON b."userId"=u."id" LEFT JOIN LATERAL (SELECT "name" FROM "Store" WHERE "ownerId"=u."id" AND "status"='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1) s ON TRUE WHERE u."id"=$1 AND u."status"='ACTIVE' LIMIT 1`,targetId);
    const row=rows[0];return row?{targetType,targetId,ownerId:row.id,name:row.name}:null;
  }
  const rows=await prisma.$queryRawUnsafe<Array<{id:string;ownerId:string;name:string}>>(`SELECT "id","ownerId","name" FROM "Store" WHERE "id"=$1 AND "status"='ACTIVE' LIMIT 1`,targetId);
  const row=rows[0];return row?{targetType,targetId,ownerId:row.ownerId,name:row.name}:null;
}

async function followerCount(targetType:FollowTarget,targetId:string){
  const rows=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "FollowSubscription" WHERE "targetType"=$1 AND "targetId"=$2`,targetType,targetId);
  return Number(rows[0]?.count??0n);
}

async function validSourceListing(target:TargetInfo,sourceListingId?:string){
  if(!sourceListingId)return null;
  const listing=await prisma.listing.findFirst({where:{id:sourceListingId,status:"PUBLISHED",sellerId:target.ownerId,...(target.targetType==="STORE"?{storeId:target.targetId}:{})},select:{id:true}});
  return listing?.id??null;
}

export async function registerFollowingRoutes(app:FastifyInstance){
  app.get("/account/follows/status",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    await ensureFollowingSchema();
    const query=followTargetSchema.safeParse(request.query);if(!query.success)return reply.code(400).send({error:"invalid_follow_target"});
    const target=await targetInfo(query.data.targetType,query.data.targetId);if(!target)return reply.code(404).send({error:"follow_target_not_found"});
    const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "FollowSubscription" WHERE "followerUserId"=$1 AND "targetType"=$2 AND "targetId"=$3 LIMIT 1`,user.id,target.targetType,target.targetId);
    return reply.send({following:Boolean(rows[0]),followerCount:await followerCount(target.targetType,target.targetId),ownTarget:target.ownerId===user.id,target:{type:target.targetType,id:target.targetId,name:target.name}});
  });

  app.post("/account/follows",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    await ensureFollowingSchema();
    const body=followTargetSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_follow_target"});
    const target=await targetInfo(body.data.targetType,body.data.targetId);if(!target)return reply.code(404).send({error:"follow_target_not_found"});
    if(target.ownerId===user.id)return reply.code(409).send({error:"cannot_follow_own_profile"});
    const sourceListingId=await validSourceListing(target,body.data.sourceListingId);
    await prisma.$executeRawUnsafe(`INSERT INTO "FollowSubscription" ("id","followerUserId","targetType","targetId","sourceListingId") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("followerUserId","targetType","targetId") DO NOTHING`,randomUUID(),user.id,target.targetType,target.targetId,sourceListingId);
    return reply.code(201).send({following:true,followerCount:await followerCount(target.targetType,target.targetId),target:{type:target.targetType,id:target.targetId,name:target.name}});
  });

  app.delete("/account/follows",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    await ensureFollowingSchema();
    const body=followTargetSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_follow_target"});
    await prisma.$executeRawUnsafe(`DELETE FROM "FollowSubscription" WHERE "followerUserId"=$1 AND "targetType"=$2 AND "targetId"=$3`,user.id,body.data.targetType,body.data.targetId);
    return reply.send({following:false,followerCount:await followerCount(body.data.targetType,body.data.targetId)});
  });

  app.get("/account/follows",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    await ensureFollowingSchema();
    const rows=await prisma.$queryRawUnsafe<Array<{id:string;targetType:FollowTarget;targetId:string;createdAt:Date;name:string|null;slug:string|null;avatarUrl:string|null}>>(`
      SELECT f."id",f."targetType",f."targetId",f."createdAt",
        CASE WHEN f."targetType"='STORE' THEN s."name" ELSE COALESCE(us."name",b."tradeName",p."displayName",p."firstName",'Membre Petit Annonces') END AS "name",
        CASE WHEN f."targetType"='STORE' THEN s."slug" ELSE NULL END AS "slug",
        CASE WHEN f."targetType"='STORE' THEN s."logoUrl" ELSE COALESCE(p."avatarUrl",us."logoUrl") END AS "avatarUrl"
      FROM "FollowSubscription" f
      LEFT JOIN "Store" s ON f."targetType"='STORE' AND s."id"=f."targetId" AND s."status"='ACTIVE'
      LEFT JOIN "User" u ON f."targetType"='USER' AND u."id"=f."targetId" AND u."status"='ACTIVE'
      LEFT JOIN "UserProfile" p ON p."userId"=u."id"
      LEFT JOIN "BusinessProfile" b ON b."userId"=u."id"
      LEFT JOIN LATERAL (SELECT "name","logoUrl" FROM "Store" WHERE "ownerId"=u."id" AND "status"='ACTIVE' ORDER BY "createdAt" ASC LIMIT 1) us ON TRUE
      WHERE f."followerUserId"=$1 AND ((f."targetType"='STORE' AND s."id" IS NOT NULL) OR (f."targetType"='USER' AND u."id" IS NOT NULL))
      ORDER BY f."createdAt" DESC LIMIT 200`,user.id);
    return reply.send({follows:rows});
  });
}

export async function notifyFollowersForListing(listingId:string){
  await ensureFollowingSchema();
  const listing=await prisma.listing.findFirst({where:{id:listingId,status:"PUBLISHED"},select:{id:true,title:true,slug:true,sellerId:true,storeId:true,publishedAt:true,seller:{select:{profile:{select:{displayName:true,firstName:true}},business:{select:{tradeName:true,legalName:true}}}},store:{select:{id:true,name:true,slug:true}}}});
  if(!listing)return{followers:0,queued:0};
  const sellerName=listing.store?.name??listing.seller.business?.tradeName??listing.seller.profile?.displayName??listing.seller.profile?.firstName??"un vendeur";
  const followers=await prisma.$queryRawUnsafe<Array<{userId:string;storeFollow:boolean;userFollow:boolean}>>(`
    SELECT f."followerUserId" AS "userId",
      BOOL_OR(f."targetType"='STORE') AS "storeFollow",
      BOOL_OR(f."targetType"='USER') AS "userFollow"
    FROM "FollowSubscription" f
    WHERE f."followerUserId"<>$1
      AND ((f."targetType"='USER' AND f."targetId"=$1) OR ($2::text IS NOT NULL AND f."targetType"='STORE' AND f."targetId"=$2))
      AND f."createdAt"<=COALESCE($3,CURRENT_TIMESTAMP)
    GROUP BY f."followerUserId"`,listing.sellerId,listing.storeId,listing.publishedAt);
  let queued=0;
  for(let offset=0;offset<followers.length;offset+=25){
    const batch=followers.slice(offset,offset+25);
    const results=await Promise.allSettled(batch.map(async follower=>{
      const sourceName=follower.storeFollow&&listing.store?.name?listing.store.name:sellerName;
      await deliverUserEvent({
        userId:follower.userId,
        eventKind:"LISTING",
        notificationKind:"LISTING",
        title:`Nouvelle annonce de ${sourceName}`,
        body:`« ${listing.title??"Nouvelle annonce"} » vient d’être publiée.`,
        actionUrl:listing.slug?`/annonce/${encodeURIComponent(listing.slug)}`:"/recherche",
        suppressEmail:true,
        dedupeKey:`followed-listing:${listing.id}:${follower.userId}`,
        metadata:{purpose:"FOLLOWED_SELLER_NEW_LISTING",listingId:listing.id,sellerId:listing.sellerId,storeId:listing.storeId,followSource:follower.storeFollow?"STORE":"USER"},
      });
    }));
    queued+=results.filter(result=>result.status==="fulfilled").length;
  }
  return{followers:followers.length,queued};
}
