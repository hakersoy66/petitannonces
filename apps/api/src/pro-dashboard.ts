import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { requireProfessionalContext } from "./pro-suite.js";
import { calculateTrustScore } from "./trust-score.js";

const activeOrderStatuses=["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED"];

export async function registerProfessionalDashboardRoutes(app:FastifyInstance){
  app.get("/pro/dashboard",async(request,reply)=>{
    const auth=await requireProfessionalContext(request,reply,"DASHBOARD");if(!auth)return;
    const ownerUserId=auth.ctx.ownerUserId;
    const owner=await prisma.user.findUnique({where:{id:ownerUserId},select:{id:true,email:true,createdAt:true}});
    if(!owner)return reply.code(404).send({error:"professional_owner_not_found"});
    const [profile,business,stores,subscription,listingGroups,conversations,pendingOffers,orderSummary,recentListings,recentOrders,reviewSummary]=await Promise.all([
      prisma.userProfile.findUnique({where:{userId:ownerUserId},select:{displayName:true,firstName:true,lastName:true,avatarUrl:true,phone:true}}),
      prisma.businessProfile.findUnique({where:{userId:ownerUserId}}),
      prisma.store.findMany({where:{ownerId:ownerUserId},select:{id:true,name:true,slug:true,status:true,isVerified:true,logoUrl:true,city:true,_count:{select:{listings:true}}},orderBy:{createdAt:"asc"}}),
      prisma.professionalSubscription.findFirst({where:{userId:ownerUserId,OR:[{status:{in:["ACTIVE","PAST_DUE"]}},{status:"TRIALING",trialEndsAt:{gt:new Date()}}]},include:{plan:true},orderBy:{createdAt:"desc"}}),
      prisma.listing.groupBy({by:["status"],where:{sellerId:ownerUserId},_count:{_all:true}}),
      prisma.conversation.findMany({where:{sellerId:ownerUserId},select:{buyerId:true,buyerLastReadAt:true,sellerLastReadAt:true,messages:{orderBy:{createdAt:"desc"},take:1,select:{createdAt:true,senderId:true}}},take:100}),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "Offer" o JOIN "Listing" l ON l."id"=o."listingId" WHERE o."recipientId"=$1 AND o."status"='PENDING' AND l."sellerId"=$1`,ownerUserId),
      prisma.$queryRawUnsafe<Array<{orders:number;completed:number;revenue:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "status" = ANY($2::"OrderStatus"[]))::int AS orders, COUNT(*) FILTER (WHERE "status"='COMPLETED')::int AS completed, COALESCE(SUM("sellerNetMinor") FILTER (WHERE "status" = ANY($2::"OrderStatus"[])),0)::bigint AS revenue FROM "MarketplaceOrder" WHERE "sellerId"=$1`,ownerUserId,activeOrderStatuses),
      prisma.listing.findMany({where:{sellerId:ownerUserId},select:{id:true,title:true,slug:true,status:true,priceMinor:true,currency:true,city:true,updatedAt:true,store:{select:{name:true}},category:{select:{name:true,domain:true}},property:{select:{transactionType:true}}},orderBy:{updatedAt:"desc"},take:6}),
      prisma.$queryRawUnsafe<Array<{id:string;orderNumber:string;status:string;sellerNetMinor:number;currency:string;createdAt:Date;listingTitle:string|null}>>(`SELECT o."id",o."orderNumber",o."status"::text,o."sellerNetMinor",o."currency",o."createdAt",l."title" AS "listingTitle" FROM "MarketplaceOrder" o LEFT JOIN "Listing" l ON l."id"=o."listingId" WHERE o."sellerId"=$1 AND o."status" = ANY($2::"OrderStatus"[]) ORDER BY o."createdAt" DESC LIMIT 6`,ownerUserId,activeOrderStatuses),
      prisma.$queryRawUnsafe<Array<{count:bigint;average:number|null}>>(`SELECT COUNT(*)::bigint AS "count", AVG("rating")::float AS "average" FROM "MarketplaceReview" WHERE "revieweeId"=$1`,ownerUserId),
    ]);
    const listingCounts:Record<string,number>={DRAFT:0,PENDING:0,PUBLISHED:0,SUSPENDED:0,SOLD:0,EXPIRED:0};for(const row of listingGroups)listingCounts[row.status]=row._count._all;
    const unreadConversations=conversations.filter(c=>{const latest=c.messages[0];if(!latest||latest.senderId!==c.buyerId)return false;const read=c.sellerLastReadAt;return !read||latest.createdAt>read}).length;
    const recentIds=recentListings.map(x=>x.id);const media=recentIds.length?await prisma.$queryRawUnsafe<Array<{listingId:string;publicUrl:string}>>(`SELECT DISTINCT ON ("listingId") "listingId","publicUrl" FROM "ListingMedia" WHERE "listingId"=ANY($1::text[]) AND "status"='READY' AND "publicUrl" IS NOT NULL ORDER BY "listingId","isCover" DESC,"sortOrder" ASC,"createdAt" ASC`,recentIds):[];const mediaMap=new Map(media.map(x=>[x.listingId,x.publicUrl] as const));
    const plan=subscription?.plan??null;const maxStores=plan?.maxStores??1;const name=business?.tradeName??business?.legalName??profile?.displayName??profile?.firstName??owner.email.split("@")[0];
    const reviewCount=Number(reviewSummary[0]?.count??0n);const reviewAverage=reviewSummary[0]?.average??null;const completedSales=Number(orderSummary[0]?.completed??0);const verified=business?.verificationStatus==="VERIFIED"||stores.some(s=>s.isVerified);const trust=calculateTrustScore({verified,reviewCount,reviewAverage,completedSales,memberSince:owner.createdAt});
    return reply.send({
      access:auth.ctx,
      user:{id:owner.id,email:owner.email,name,avatarUrl:profile?.avatarUrl??null},
      business:business?{id:business.id,legalName:business.legalName,tradeName:business.tradeName,verificationStatus:business.verificationStatus,siren:business.siren,siret:business.siret}:null,
      subscription:subscription?{id:subscription.id,status:subscription.status,trialEndsAt:subscription.trialEndsAt,currentPeriodEnd:subscription.currentPeriodEnd,plan}:null,
      stats:{activeListings:listingCounts.PUBLISHED,totalListings:Object.values(listingCounts).reduce((a,b)=>a+b,0),draftListings:listingCounts.DRAFT,pendingListings:listingCounts.PENDING,soldListings:listingCounts.SOLD,unreadConversations,pendingOffers:Number(pendingOffers[0]?.count??0n),stores:stores.length,maxStores,orders:Number(orderSummary[0]?.orders??0),completedOrders:Number(orderSummary[0]?.completed??0),sellerRevenueMinor:Number(orderSummary[0]?.revenue??0n),reviewCount,reviewAverage,trustScore:trust.score,trustLevel:trust.level,verified},
      stores,
      recentListings:recentListings.map(x=>({...x,imageUrl:mediaMap.get(x.id)??null})),
      recentOrders,
    });
  });
}