import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { requireListingUser } from "./listing-auth.js";
import { getUserReputationDashboard } from "./reputation.js";
import { hiddenEditWorkingIds } from "./listing-edit-session.js";

const listingStatuses = ["DRAFT", "PENDING", "PUBLISHED", "SUSPENDED", "SOLD", "EXPIRED"] as const;

export async function registerAccountDashboardRoutes(app: FastifyInstance) {
  app.get("/account/dashboard", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;

    const hiddenWorkingIds=await hiddenEditWorkingIds(user.id);
    const visibleListingWhere:any={sellerId:user.id,...(hiddenWorkingIds.length?{id:{notIn:hiddenWorkingIds}}:{})};
    const [profile, groupedListings, recentListings, conversations, pendingOffers, unreadNotificationsRows, stores, defaultAddressCount, twoFactorRows, phoneRows, orderSummaryRows, creditRows] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: user.id } }),
      prisma.listing.groupBy({ by: ["status"], where: visibleListingWhere, _count: { _all: true } }),
      prisma.listing.findMany({ where: visibleListingWhere, select: { id: true,title: true,slug: true,status: true,priceMinor: true,currency: true,city: true,updatedAt: true,publishedAt: true,category: { select: { name: true, slug: true, domain: true } }, property: { select: { transactionType: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }),
      prisma.conversation.findMany({ where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] }, select: { id: true,buyerId: true,sellerId: true,buyerLastReadAt: true,sellerLastReadAt: true,lastMessageAt: true,updatedAt: true,messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, senderId: true } } }, orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }], take: 100 }),
      prisma.offer.count({ where: { recipientId: user.id, status: "PENDING" } }),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "UserNotification" WHERE "userId"=$1 AND "readAt" IS NULL`,user.id),
      prisma.store.findMany({ where: { ownerId: user.id }, select: { id: true, name: true, slug: true, status: true, isVerified: true }, take: 3 }),
      prisma.address.count({ where: { userId: user.id, isDefault: true } }),
      prisma.$queryRawUnsafe<Array<{enabled:boolean}>>(`SELECT "enabled" FROM "UserTwoFactor" WHERE "userId"=$1 LIMIT 1`,user.id),
      prisma.$queryRawUnsafe<Array<{phoneVerifiedAt:Date|null}>>(`SELECT "phoneVerifiedAt" FROM "UserProfile" WHERE "userId"=$1 LIMIT 1`,user.id),
      prisma.$queryRawUnsafe<Array<{purchases:number;sales:number;active:number}>>(`SELECT COUNT(*) FILTER (WHERE "buyerId"=$1 AND "status" NOT IN ('PENDING_PAYMENT','CANCELED'))::int AS purchases, COUNT(*) FILTER (WHERE "sellerId"=$1 AND "status" NOT IN ('PENDING_PAYMENT','CANCELED'))::int AS sales, COUNT(*) FILTER (WHERE ("buyerId"=$1 OR "sellerId"=$1) AND "status" NOT IN ('PENDING_PAYMENT','CANCELED','COMPLETED','REFUNDED'))::int AS active FROM "MarketplaceOrder" WHERE "buyerId"=$1 OR "sellerId"=$1`,user.id),
      prisma.$queryRawUnsafe<Array<{balanceMinor:number;currency:string}>>(`SELECT "balanceMinor","currency" FROM "SiteCreditWallet" WHERE "userId"=$1 LIMIT 1`,user.id).catch(()=>[]),
    ]);

    const counts = Object.fromEntries(listingStatuses.map((status) => [status, 0])) as Record<(typeof listingStatuses)[number], number>;
    for (const row of groupedListings) counts[row.status] = row._count._all;

    const unreadConversations = conversations.filter((conversation) => {
      const latest=conversation.messages[0];
      if(!latest||latest.senderId===user.id)return false;
      const readAt = conversation.buyerId === user.id ? conversation.buyerLastReadAt : conversation.sellerLastReadAt;
      return !readAt || latest.createdAt > readAt;
    }).length;

    const profileHealth = {
      emailVerified: Boolean(user.emailVerifiedAt),
      profileComplete: Boolean(profile?.displayName && profile?.firstName && profile?.lastName),
      phoneVerified: Boolean(phoneRows[0]?.phoneVerifiedAt),
      defaultAddress: defaultAddressCount > 0,
      twoFactorEnabled: twoFactorRows[0]?.enabled === true,
    };
    const completedHealthSteps = Object.values(profileHealth).filter(Boolean).length;
    const profileCompletion = completedHealthSteps * 20;

    const recentIds = recentListings.map((listing) => listing.id);
    const mediaRows = recentIds.length ? await prisma.$queryRawUnsafe<Array<{ listingId:string; publicUrl:string }>>(`SELECT DISTINCT ON (lm."listingId") lm."listingId",lm."publicUrl" FROM "ListingMedia" lm WHERE lm."listingId" = ANY($1::text[]) AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL ORDER BY lm."listingId",lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC`, recentIds) : [];
    const mediaByListing = new Map(mediaRows.map((row) => [row.listingId, row.publicUrl] as const));

    return reply.send({
      user: { id: user.id,email: user.email,kind: user.kind,displayName: profile?.displayName ?? profile?.firstName ?? user.email.split("@")[0],avatarUrl: profile?.avatarUrl ?? null },
      stats: { listings: counts,totalListings: Object.values(counts).reduce((sum, value) => sum + value, 0),unreadConversations,pendingOffers,unreadNotifications:Number(unreadNotificationsRows[0]?.count??0n) },
      profileHealth: { ...profileHealth, completion: profileCompletion },
      recentListings: recentListings.map((listing) => ({ ...listing, imageUrl: mediaByListing.get(listing.id) ?? null })),
      stores,
      commerce: { purchases:Number(orderSummaryRows[0]?.purchases??0), sales:Number(orderSummaryRows[0]?.sales??0), active:Number(orderSummaryRows[0]?.active??0), creditBalanceMinor:Number(creditRows[0]?.balanceMinor??0), creditCurrency:creditRows[0]?.currency??"EUR" },
    });
  });

  app.get("/account/reputation", async (request, reply) => {
    const user=await requireListingUser(request,reply);if(!user)return;
    const dashboard=await getUserReputationDashboard(user.id);
    if(!dashboard)return reply.code(404).send({error:"reputation_not_found"});
    return reply.send(dashboard);
  });
}
