import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { requireListingUser } from "./listing-auth.js";

const listingStatuses = ["DRAFT", "PENDING", "PUBLISHED", "SUSPENDED", "SOLD", "EXPIRED"] as const;

export async function registerAccountDashboardRoutes(app: FastifyInstance) {
  app.get("/account/dashboard", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;

    const [profile, groupedListings, recentListings, conversations, pendingOffers, stores] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: user.id } }),
      prisma.listing.groupBy({ by: ["status"], where: { sellerId: user.id }, _count: { _all: true } }),
      prisma.listing.findMany({
        where: { sellerId: user.id },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          priceMinor: true,
          currency: true,
          city: true,
          updatedAt: true,
          publishedAt: true,
          category: { select: { name: true, slug: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
      }),
      prisma.conversation.findMany({
        where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          buyerLastReadAt: true,
          sellerLastReadAt: true,
          lastMessageAt: true,
          updatedAt: true,
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        take: 100,
      }),
      prisma.offer.count({ where: { recipientId: user.id, status: "PENDING" } }),
      prisma.store.findMany({ where: { ownerId: user.id }, select: { id: true, name: true, slug: true, status: true, isVerified: true }, take: 3 }),
    ]);

    const counts = Object.fromEntries(listingStatuses.map((status) => [status, 0])) as Record<(typeof listingStatuses)[number], number>;
    for (const row of groupedListings) counts[row.status] = row._count._all;

    const unreadConversations = conversations.filter((conversation) => {
      const readAt = conversation.buyerId === user.id ? conversation.buyerLastReadAt : conversation.sellerLastReadAt;
      const latestAt = conversation.messages[0]?.createdAt ?? conversation.lastMessageAt;
      return Boolean(latestAt && (!readAt || latestAt > readAt));
    }).length;

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        kind: user.kind,
        displayName: profile?.displayName ?? profile?.firstName ?? user.email.split("@")[0],
        avatarUrl: profile?.avatarUrl ?? null,
      },
      stats: {
        listings: counts,
        totalListings: Object.values(counts).reduce((sum, value) => sum + value, 0),
        unreadConversations,
        pendingOffers,
      },
      recentListings,
      stores,
    });
  });
}
