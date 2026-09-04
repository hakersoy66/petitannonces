import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthorized" }); return null;
  }
  return session.user;
}

type OrderActivityRow = {
  id: string;
  orderNumber: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  status: string;
  totalAmountMinor: number;
  sellerNetMinor: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function registerAccountActivityRoutes(app: FastifyInstance) {
  app.get("/account/activity", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ limit: z.coerce.number().int().min(10).max(100).default(60) }).safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const [conversations, offers, orders] = await Promise.all([
      prisma.conversation.findMany({
        where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
        include: {
          listing: { select: { id: true, title: true, slug: true } },
          buyer: { select: { id: true, profile: { select: { displayName: true } } } },
          seller: { select: { id: true, profile: { select: { displayName: true } } } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, body: true, kind: true, senderId: true, createdAt: true } },
        },
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }], take: 40,
      }),
      prisma.offer.findMany({
        where: { OR: [{ makerId: user.id }, { recipientId: user.id }] },
        include: { listing: { select: { id: true, title: true, slug: true } } },
        orderBy: { updatedAt: "desc" }, take: 40,
      }),
      prisma.$queryRawUnsafe<OrderActivityRow[]>(`SELECT "id","orderNumber","listingId","buyerId","sellerId","status","totalAmountMinor","sellerNetMinor","currency","createdAt","updatedAt" FROM "MarketplaceOrder" WHERE "buyerId"=$1 OR "sellerId"=$1 ORDER BY "updatedAt" DESC LIMIT 40`, user.id),
    ]);

    const listingIds = [...new Set(orders.map((order) => order.listingId))];
    const listingRows = listingIds.length ? await prisma.listing.findMany({ where: { id: { in: listingIds } }, select: { id: true, title: true, slug: true } }) : [];
    const listingMap = new Map(listingRows.map((listing) => [listing.id, listing]));

    const items: Array<Record<string, unknown> & { occurredAt: Date }> = [];

    for (const conversation of conversations) {
      const last = conversation.messages[0];
      if (!last) continue;
      const other = conversation.buyerId === user.id ? conversation.seller : conversation.buyer;
      items.push({
        id: `message:${last.id}`, type: "MESSAGE", occurredAt: last.createdAt,
        title: last.senderId === user.id ? "Message envoyé" : "Nouveau message",
        description: last.body ?? (last.kind === "OFFER" ? "Offre envoyée dans la conversation" : "Pièce jointe"),
        listing: conversation.listing, conversationId: conversation.id,
        counterpart: other.profile?.displayName ?? "Membre Petit Annonces",
        direction: last.senderId === user.id ? "OUT" : "IN",
      });
    }

    for (const offer of offers) {
      items.push({
        id: `offer:${offer.id}`, type: "OFFER", occurredAt: offer.updatedAt,
        title: offer.makerId === user.id ? "Votre offre" : "Offre reçue",
        description: `${(offer.amountMinor / 100).toLocaleString("fr-FR", { style: "currency", currency: offer.currency })} · ${offer.status}`,
        listing: offer.listing, offerId: offer.id, status: offer.status,
        direction: offer.makerId === user.id ? "OUT" : "IN",
      });
    }

    for (const order of orders) {
      const asBuyer = order.buyerId === user.id;
      items.push({
        id: `order:${order.id}`, type: asBuyer ? "PURCHASE" : "SALE", occurredAt: order.updatedAt,
        title: asBuyer ? "Achat" : "Vente",
        description: `${order.orderNumber} · ${order.status}`,
        listing: listingMap.get(order.listingId) ?? { id: order.listingId, title: "Annonce", slug: null },
        orderId: order.id, status: order.status,
        amountMinor: asBuyer ? order.totalAmountMinor : order.sellerNetMinor, currency: order.currency,
      });
    }

    items.sort((a, b) => new Date(String(b.occurredAt)).getTime() - new Date(String(a.occurredAt)).getTime());
    const limited = items.slice(0, parsed.data.limit);
    const summary = {
      messages: limited.filter((item) => item.type === "MESSAGE").length,
      offers: limited.filter((item) => item.type === "OFFER").length,
      purchases: limited.filter((item) => item.type === "PURCHASE").length,
      sales: limited.filter((item) => item.type === "SALE").length,
    };
    return reply.send({ summary, items: limited });
  });
}
