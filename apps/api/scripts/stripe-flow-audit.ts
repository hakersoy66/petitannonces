import { prisma } from "@pa/database";

async function main(){
  const [events, sellerReady, sellerTotal, plans, subs] = await Promise.all([
    prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "provider","eventType","processedAt","lastError","createdAt" FROM "PaymentWebhookEvent" WHERE "provider" IN ('stripe-billing-test','stripe-billing') ORDER BY "createdAt" DESC LIMIT 20`),
    prisma.$queryRawUnsafe<Array<{count:string}>>(`SELECT COUNT(*)::text AS count FROM "MarketplaceSellerAccount" WHERE "onboardingStatus"='ACTIVE' AND "payoutsEnabled"=TRUE AND "detailsSubmitted"=TRUE`),
    prisma.$queryRawUnsafe<Array<{count:string}>>(`SELECT COUNT(*)::text AS count FROM "MarketplaceSellerAccount"`),
    prisma.professionalPlan.findMany({select:{code:true,name:true,monthlyPriceMinor:true,isActive:true}}),
    prisma.professionalSubscription.findMany({take:10,orderBy:{createdAt:"desc"},select:{status:true,externalProvider:true,externalSubscriptionId:true,createdAt:true}}),
  ]);
  console.log(JSON.stringify({events,sellers:{ready:Number(sellerReady[0]?.count??0),total:Number(sellerTotal[0]?.count??0)},plans,subscriptions:subs},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());