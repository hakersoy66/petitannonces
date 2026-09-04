import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const MESSAGE_WINDOW_MS = 60_000;
const MESSAGE_LIMIT_PER_WINDOW = 12;
const OFFER_MIN_MINOR = 100;
const recentMessages = new Map<string, number[]>();

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") { reply.code(401).send({ error: "unauthorized" }); return null; }
  return session.user;
}

function canSendMessage(userId: string) {
  const now = Date.now();
  const entries = (recentMessages.get(userId) ?? []).filter((ts) => now - ts < MESSAGE_WINDOW_MS);
  if (entries.length >= MESSAGE_LIMIT_PER_WINDOW) return false;
  entries.push(now); recentMessages.set(userId, entries); return true;
}

function looksUnsafeMessage(body: string) {
  const normalized = body.toLowerCase();
  return ["western union", "mandat cash", "crypto uniquement", "paiement hors plateforme", "telegram uniquement"].some((term) => normalized.includes(term));
}

async function getConversationForUser(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({ where: { id: conversationId, OR: [{ buyerId: userId }, { sellerId: userId }] }, include: { listing: true } });
}

async function notify(userId:string,kind:"MESSAGE"|"OFFER",title:string,body:string,actionUrl:string,metadata:Record<string,unknown>){
  await prisma.$executeRawUnsafe(`INSERT INTO "UserNotification" ("id","userId","kind","title","body","actionUrl","metadata") VALUES ($1,$2,$3::"NotificationKind",$4,$5,$6,$7::jsonb)`,randomUUID(),userId,kind,title,body,actionUrl,JSON.stringify(metadata));
}

export async function registerMessagingRoutes(app: FastifyInstance) {
  app.post("/conversations", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ listingId: z.string().min(1) }).safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, status: "PUBLISHED" } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    if (listing.sellerId === user.id) return reply.code(400).send({ error: "cannot_message_own_listing" });
    const conversation = await prisma.conversation.upsert({ where: { listingId_buyerId_sellerId: { listingId: listing.id, buyerId: user.id, sellerId: listing.sellerId } }, create: { listingId: listing.id, buyerId: user.id, sellerId: listing.sellerId }, update: { status: "OPEN" } });
    return reply.code(201).send({ conversation });
  });

  app.get("/account/message-summary", async (request, reply) => {
    const user=await requireUser(request,reply); if(!user)return;
    const [conversations,pendingOffers,unreadNotifications]=await Promise.all([
      prisma.conversation.findMany({where:{OR:[{buyerId:user.id},{sellerId:user.id}]},select:{buyerId:true,buyerLastReadAt:true,sellerLastReadAt:true,lastMessageAt:true,messages:{orderBy:{createdAt:"desc"},take:1,select:{createdAt:true,senderId:true}}},take:100}),
      prisma.offer.count({where:{recipientId:user.id,status:"PENDING"}}),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "UserNotification" WHERE "userId"=$1 AND "readAt" IS NULL`,user.id),
    ]);
    const unreadConversations=conversations.filter((c)=>{const latest=c.messages[0];if(!latest||latest.senderId===user.id)return false;const readAt=c.buyerId===user.id?c.buyerLastReadAt:c.sellerLastReadAt;return !readAt||latest.createdAt>readAt;}).length;
    return reply.send({unreadConversations,pendingOffers,unreadNotifications:Number(unreadNotifications[0]?.count??0n)});
  });

  app.get("/conversations", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const conversations = await prisma.conversation.findMany({ where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] }, include: { listing: { select: { id: true, title: true, slug: true, priceMinor: true, currency: true } }, buyer: { select: { id: true, profile: { select: { displayName: true, avatarUrl: true } } } }, seller: { select: { id: true, profile: { select: { displayName: true, avatarUrl: true } } } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }], take: 100 });
    return reply.send({ conversations });
  });

  app.get("/conversations/:id/messages", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_conversation" });
    const conversation = await getConversationForUser(parsed.data.id, user.id); if (!conversation) return reply.code(404).send({ error: "conversation_not_found" });
    const messages = await prisma.message.findMany({ where: { conversationId: conversation.id }, include: { offer: true }, orderBy: { createdAt: "asc" }, take: 500 });
    const readField = conversation.buyerId === user.id ? "buyerLastReadAt" : "sellerLastReadAt";
    await prisma.conversation.update({ where: { id: conversation.id }, data: { [readField]: new Date() } });
    await prisma.$executeRawUnsafe(`UPDATE "UserNotification" SET "readAt"=COALESCE("readAt",CURRENT_TIMESTAMP) WHERE "userId"=$1 AND "readAt" IS NULL AND "actionUrl"=$2`,user.id,`/messages?conversation=${conversation.id}`);
    return reply.send({ conversation, messages });
  });

  app.post("/conversations/:id/messages", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!canSendMessage(user.id)) return reply.code(429).send({ error: "message_rate_limited" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ body: z.string().trim().min(1).max(4000), attachmentUrl: z.string().url().max(1000).optional(), attachmentName: z.string().max(255).optional(), attachmentMime: z.string().max(120).optional(), attachmentSize: z.number().int().nonnegative().max(20 * 1024 * 1024).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_message" });
    const conversation = await getConversationForUser(params.data.id, user.id); if (!conversation || conversation.status !== "OPEN") return reply.code(404).send({ error: "conversation_not_available" });
    if (looksUnsafeMessage(body.data.body)) return reply.code(422).send({ error: "message_requires_review", reason: "possible_off_platform_payment_or_scam" });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderId: user.id, kind: body.data.attachmentUrl ? "FILE" : "TEXT", body: body.data.body, attachmentUrl: body.data.attachmentUrl, attachmentName: body.data.attachmentName, attachmentMime: body.data.attachmentMime, attachmentSize: body.data.attachmentSize } });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
    const recipientId=conversation.buyerId===user.id?conversation.sellerId:conversation.buyerId;
    await notify(recipientId,"MESSAGE","Nouveau message",body.data.body.slice(0,180),`/messages?conversation=${conversation.id}`,{conversationId:conversation.id,listingId:conversation.listingId,messageId:message.id});
    return reply.code(201).send({ message });
  });

  app.post("/conversations/:id/read", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_conversation" });
    const conversation = await getConversationForUser(parsed.data.id, user.id); if (!conversation) return reply.code(404).send({ error: "conversation_not_found" });
    const data = conversation.buyerId === user.id ? { buyerLastReadAt: new Date() } : { sellerLastReadAt: new Date() };
    await prisma.conversation.update({ where: { id: conversation.id }, data });
    await prisma.$executeRawUnsafe(`UPDATE "UserNotification" SET "readAt"=COALESCE("readAt",CURRENT_TIMESTAMP) WHERE "userId"=$1 AND "readAt" IS NULL AND "actionUrl"=$2`,user.id,`/messages?conversation=${conversation.id}`);
    return reply.send({ read: true });
  });

  app.post("/conversations/:id/offers", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params); const body = z.object({ amount: z.number().positive(), parentOfferId: z.string().optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_offer" });
    const conversation = await getConversationForUser(params.data.id, user.id); if (!conversation || conversation.status !== "OPEN") return reply.code(404).send({ error: "conversation_not_available" });
    const settings=await prisma.$queryRawUnsafe<Array<{acceptsOffers:boolean}>>(`SELECT "acceptsOffers" FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`,conversation.listingId);
    if(settings[0]?.acceptsOffers===false)return reply.code(409).send({error:"offers_disabled"});
    const amountMinor = Math.round(body.data.amount * 100); if (amountMinor < OFFER_MIN_MINOR) return reply.code(400).send({ error: "offer_too_low" });
    const recipientId = conversation.buyerId === user.id ? conversation.sellerId : conversation.buyerId;
    let parentOfferId: string | undefined;
    if (body.data.parentOfferId) { const parent = await prisma.offer.findFirst({ where: { id: body.data.parentOfferId, conversationId: conversation.id } }); if (!parent || parent.recipientId !== user.id || parent.status !== "PENDING") return reply.code(409).send({ error: "offer_cannot_be_countered" }); parentOfferId = parent.id; await prisma.offer.update({ where: { id: parent.id }, data: { status: "COUNTERED", respondedAt: new Date() } }); }
    const result = await prisma.$transaction(async (tx) => { const message = await tx.message.create({ data: { conversationId: conversation.id, senderId: user.id, kind: "OFFER", body: `Offre: ${(amountMinor / 100).toFixed(2)} €` } }); const offer = await tx.offer.create({ data: { conversationId: conversation.id, listingId: conversation.listingId, messageId: message.id, makerId: user.id, recipientId, parentOfferId, amountMinor, currency: conversation.listing.currency, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } }); await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } }); return { message, offer }; });
    await notify(recipientId,"OFFER","Nouvelle offre reçue",`Vous avez reçu une offre de ${(amountMinor/100).toLocaleString("fr-FR",{style:"currency",currency:conversation.listing.currency})}.`,`/messages?conversation=${conversation.id}`,{conversationId:conversation.id,listingId:conversation.listingId,offerId:result.offer.id,amountMinor});
    return reply.code(201).send(result);
  });

  app.post("/offers/:id/respond", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params); const body = z.object({ action: z.enum(["ACCEPT", "DECLINE"]) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_offer_response" });
    const offer = await prisma.offer.findUnique({ where: { id: params.data.id } }); if (!offer || offer.recipientId !== user.id) return reply.code(404).send({ error: "offer_not_found" });
    if (offer.status !== "PENDING") return reply.code(409).send({ error: "offer_already_resolved" });
    if (offer.expiresAt && offer.expiresAt <= new Date()) { await prisma.offer.update({ where: { id: offer.id }, data: { status: "EXPIRED" } }); return reply.code(409).send({ error: "offer_expired" }); }
    const status = body.data.action === "ACCEPT" ? "ACCEPTED" : "DECLINED"; await prisma.offer.update({ where: { id: offer.id }, data: { status, respondedAt: new Date() } });
    if (status === "ACCEPTED") await prisma.offer.updateMany({ where: { conversationId: offer.conversationId, id: { not: offer.id }, status: "PENDING" }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
    await notify(offer.makerId,"OFFER",status==="ACCEPTED"?"Offre acceptée":"Offre refusée",status==="ACCEPTED"?"Votre offre a été acceptée.":"Votre offre a été refusée.",`/messages?conversation=${offer.conversationId}`,{conversationId:offer.conversationId,offerId:offer.id,status});
    return reply.send({ offerId: offer.id, status });
  });

  app.post("/offers/:id/withdraw", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_offer" });
    const offer = await prisma.offer.findUnique({ where: { id: parsed.data.id } }); if (!offer || offer.makerId !== user.id) return reply.code(404).send({ error: "offer_not_found" });
    if (offer.status !== "PENDING") return reply.code(409).send({ error: "offer_already_resolved" });
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "WITHDRAWN", respondedAt: new Date() } }); return reply.send({ offerId: offer.id, status: "WITHDRAWN" });
  });
}
