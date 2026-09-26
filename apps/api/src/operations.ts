import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { activateListingLifetime } from "./listing-lifecycle.js";
import { ensurePayoutReconciliationSchema } from "./marketplace-stripe.js";
import { getPayoutProviderRuntime } from "./marketplace-payout-provider.js";
import { deliverUserEvent } from "./notification-delivery.js";
import { deleteStoredObject } from "./storage.js";
import { createAiSupportReply, ensureSupportFaqSchema, listSupportFaqs, publishFaqFromResolvedTicket } from "./support-ai.js";
import { getReputationBadgeHistory, getUserReputation } from "./reputation.js";
import { queueTransactionalEmail } from "./transactional-email.js";
import { notifyInstantSavedSearchesForListing } from "./saved-search-alerts.js";

const SESSION_COOKIE = "pa_session";
const ADMIN_ROLES = new Set(["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","FINANCE","COMPLIANCE","MARKETING"]);

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function bearerToken(request: FastifyRequest) {
  const value=request.headers.authorization;
  if(typeof value!=="string")return null;
  const match=/^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim()||null;
}

async function currentUser(request: FastifyRequest) {
  const token = bearerToken(request) ?? request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { roles: true } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  return session.user;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) { reply.code(401).send({ error: "unauthorized" }); return null; }
  return user;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply, allowed?: string[]) {
  const user = await requireUser(request, reply); if (!user) return null;
  const roles = user.roles.map((r: { role: string }) => r.role);
  const permitted = allowed ? roles.some((role: string) => allowed.includes(role)) : roles.some((role: string) => ADMIN_ROLES.has(role));
  if (!permitted) { reply.code(403).send({ error: "forbidden" }); return null; }
  return user;
}

async function audit(actorUserId: string, action: string, entityType: string, entityId?: string, metadata?: unknown) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    randomUUID(), actorUserId, action, entityType, entityId ?? null, metadata ? JSON.stringify(metadata) : null,
  );
}

const SUPPORT_AUTO_CLOSE_HOURS = 24;
const SUPPORT_AUTO_CLOSE_MESSAGE = "Cette demande a été fermée automatiquement après 24 heures sans nouvelle réponse. Si vous avez encore besoin d’aide, ouvrez une nouvelle demande depuis le centre d’aide Petit Annonces.";

async function activeVacationSupportIncident(ticketId:string){
  const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "VacationIncident" WHERE "supportTicketId"=$1 AND "status" IN ('OPEN','UNDER_REVIEW') LIMIT 1`,ticketId).catch(()=>[]);
  return rows[0]??null;
}

async function closeSupportTicket(ticketId:string,message:string){
  const updated=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "SupportTicket" SET "status"='CLOSED',"resolvedAt"=COALESCE("resolvedAt",CURRENT_TIMESTAMP),"lastMessageAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"<>'CLOSED' RETURNING "id"`,ticketId);
  if(!updated.length)return false;
  await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicketMessage" ("id","ticketId","authorType","body","internalNote") VALUES ($1,$2,'SYSTEM',$3,FALSE)`,randomUUID(),ticketId,message);
  return true;
}

export async function registerOperationsRoutes(app: FastifyInstance) {
  await ensureSupportFaqSchema();

  app.get("/support/faqs", async (request, reply) => {
    const q = z.object({ category: z.string().optional(), q: z.string().max(120).optional() }).safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ faqs: await listSupportFaqs(q.data.category, q.data.q) });
  });
  app.post("/support/tickets", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ category: z.enum(["ACCOUNT","LISTING","PAYMENT","ORDER","SHIPPING","DISPUTE","PROFESSIONAL","COMPLIANCE","SAFETY","OTHER"]), subject: z.string().trim().min(4).max(180), body: z.string().trim().min(10).max(5000), orderId: z.string().optional(), listingId: z.string().optional(), conversationId: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const recentDuplicate=await prisma.$queryRawUnsafe<Array<{id:string;reference:string;status:string}>>(
      `SELECT t."id",t."reference",t."status"::text AS "status"
       FROM "SupportTicket" t
       WHERE t."userId"=$1
         AND t."status" NOT IN ('CLOSED','RESOLVED')
         AND t."category"=$2::"SupportTicketCategory"
         AND lower(trim(t."subject"))=lower(trim($3))
         AND t."createdAt">=CURRENT_TIMESTAMP-INTERVAL '10 minutes'
         AND EXISTS (
           SELECT 1 FROM "SupportTicketMessage" m
           WHERE m."ticketId"=t."id"
             AND m."authorType"='CUSTOMER'
             AND lower(trim(m."body"))=lower(trim($4))
             AND m."createdAt">=CURRENT_TIMESTAMP-INTERVAL '10 minutes'
         )
       ORDER BY t."createdAt" DESC LIMIT 1`,
      user.id,parsed.data.category,parsed.data.subject,parsed.data.body,
    );
    if(recentDuplicate[0])return reply.send({ticket:recentDuplicate[0],duplicate:true});
    const id = randomUUID();
    const reference = `SUP-${Date.now().toString(36).toUpperCase()}-${id.slice(0,6).toUpperCase()}`;
    await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicket" ("id","reference","userId","category","subject","orderId","listingId","conversationId") VALUES ($1,$2,$3,$4::"SupportTicketCategory",$5,$6,$7,$8)`, id, reference, user.id, parsed.data.category, parsed.data.subject, parsed.data.orderId ?? null, parsed.data.listingId ?? null, parsed.data.conversationId ?? null);
    await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicketMessage" ("id","ticketId","authorUserId","authorType","body") VALUES ($1,$2,$3,'CUSTOMER',$4)`, randomUUID(), id, user.id, parsed.data.body);
    const supportAgents=await prisma.user.findMany({where:{status:"ACTIVE",roles:{some:{role:{in:["SUPER_ADMIN","ADMIN","SUPPORT"]}}}},select:{id:true},take:50});
    for(const agent of supportAgents){await queueTransactionalEmail({userId:agent.id,eventKind:"SUPPORT_TICKET_CREATED",title:`Nouveau ticket support · ${reference}`,body:`Un nouveau ticket « ${parsed.data.subject} » (${parsed.data.category}) a été créé et attend votre suivi.`,actionUrl:`https://admin.petitannonces.fr/support/${encodeURIComponent(id)}`,metadata:{purpose:"SUPPORT_TICKET_CREATED",supportTicketId:id,reference,category:parsed.data.category}}).catch(error=>request.log.warn({error,supportTicketId:id,agentUserId:agent.id},"support ticket admin email queue failed"));}
    if(parsed.data.subject.startsWith("Rétractation ·")){const submittedAt=new Date().toISOString();await queueTransactionalEmail({userId:user.id,eventKind:"WITHDRAWAL_RECEIPT",title:`Rétractation reçue · ${reference}`,body:`Votre demande de rétractation a été enregistrée le ${submittedAt}. Référence : ${reference}. Contenu de votre déclaration : ${parsed.data.body}`,actionUrl:`https://petitannonces.fr/assistance?ticket=${encodeURIComponent(id)}`,metadata:{purpose:"WITHDRAWAL_RECEIPT",supportTicketId:id,reference,submittedAt,statement:parsed.data.body}}).catch(error=>request.log.warn({error,supportTicketId:id,userId:user.id},"withdrawal receipt email queue failed"));}
    const aiReply = await createAiSupportReply({ticketId:id,category:parsed.data.category,subject:parsed.data.subject,body:parsed.data.body});
    return reply.code(201).send({ ticket: { id, reference, status: aiReply.requiresHuman ? "PENDING_INTERNAL" : "PENDING_CUSTOMER" }, aiReply });
  });

  app.get("/support/tickets", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","reference","category","subject","status","priority","lastMessageAt","createdAt" FROM "SupportTicket" WHERE "userId"=$1 ORDER BY "lastMessageAt" DESC LIMIT 100`, user.id);
    return reply.send({ tickets: rows });
  });

  app.get("/support/tickets/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const tickets = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","reference","category","subject","status","priority","lastMessageAt","createdAt" FROM "SupportTicket" WHERE "id"=$1 AND "userId"=$2 LIMIT 1`, params.data.id, user.id);
    const ticket = tickets[0]; if (!ticket) return reply.code(404).send({ error: "ticket_not_found" });
    const messages = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","authorType","body","createdAt" FROM "SupportTicketMessage" WHERE "ticketId"=$1 AND "internalNote"=FALSE ORDER BY "createdAt" ASC`, params.data.id);
    return reply.send({ ticket, messages });
  });

  app.post("/support/tickets/:id/reply", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ body: z.string().trim().min(2).max(5000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const rows = await prisma.$queryRawUnsafe<Array<{id:string;status:string}>>(`SELECT "id","status"::text AS "status" FROM "SupportTicket" WHERE "id"=$1 AND "userId"=$2 LIMIT 1`,params.data.id,user.id);
    const ticket=rows[0]; if(!ticket) return reply.code(404).send({error:"ticket_not_found"});
    if(ticket.status==="CLOSED") return reply.code(409).send({error:"ticket_closed"});
    const recentDuplicate=await prisma.$queryRawUnsafe<Array<{id:string;body:string;createdAt:Date}>>(
      `SELECT "id","body","createdAt" FROM "SupportTicketMessage"
       WHERE "ticketId"=$1
         AND "authorUserId"=$2
         AND "authorType"='CUSTOMER'
         AND lower(trim("body"))=lower(trim($3))
         AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '90 seconds'
       ORDER BY "createdAt" DESC LIMIT 1`,
      ticket.id,user.id,body.data.body,
    );
    if(recentDuplicate[0])return reply.send({replied:false,duplicate:true,message:{id:recentDuplicate[0].id,authorType:"CUSTOMER",body:recentDuplicate[0].body,createdAt:recentDuplicate[0].createdAt}});
    const messageId=randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicketMessage" ("id","ticketId","authorUserId","authorType","body") VALUES ($1,$2,$3,'CUSTOMER',$4)`,messageId,ticket.id,user.id,body.data.body);
    await prisma.$executeRawUnsafe(`UPDATE "SupportTicket" SET "status"='PENDING_INTERNAL',"lastMessageAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,ticket.id);
    const meta = await prisma.$queryRawUnsafe<Array<{category:string;subject:string}>>(`SELECT "category"::text,"subject" FROM "SupportTicket" WHERE "id"=$1 LIMIT 1`,ticket.id);
    const tmeta=meta[0];
    if(tmeta){void createAiSupportReply({ticketId:ticket.id,category:tmeta.category,subject:tmeta.subject,body:body.data.body}).catch(()=>{});}
    return reply.code(201).send({replied:true,message:{id:messageId,authorType:"CUSTOMER",body:body.data.body,createdAt:new Date().toISOString()}});
  });

  app.post("/support/tickets/:id/close", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const tickets=await prisma.$queryRawUnsafe<Array<{id:string;status:string}>>(`SELECT "id","status"::text AS "status" FROM "SupportTicket" WHERE "id"=$1 AND "userId"=$2 LIMIT 1`,params.data.id,user.id);
    const ticket=tickets[0];if(!ticket)return reply.code(404).send({error:"ticket_not_found"});
    const incident=await activeVacationSupportIncident(ticket.id);if(incident)return reply.code(409).send({error:"vacation_incident_resolution_required",incidentId:incident.id});
    const closed=await closeSupportTicket(ticket.id,"Cette demande a été fermée à votre demande. Si vous avez encore besoin d’aide, vous pouvez ouvrir une nouvelle demande depuis le centre d’aide.");
    return reply.send({closed:true,alreadyClosed:!closed});
  });

  app.get("/admin/dashboard", async (request, reply) => {
    const admin = await requireAdmin(request, reply); if (!admin) return;
    const [users, listings, orders, support, moderation, disputes, finance, audience] = await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "createdAt" >= CURRENT_DATE)::int AS today FROM "User"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "status"='PUBLISHED')::int AS published FROM "Listing"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED'))::int AS active FROM "MarketplaceOrder"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*) FILTER (WHERE "status" NOT IN ('RESOLVED','CLOSED'))::int AS open FROM "SupportTicket"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS open FROM "ModerationCase" mc JOIN "Listing" l ON l."id"=mc."targetId" WHERE mc."targetType"='LISTING' AND mc."status" NOT IN ('RESOLVED','CLOSED') AND l."status"='PENDING'`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*) FILTER (WHERE "status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED'))::int AS open FROM "MarketplaceDispute"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COALESCE(SUM("totalAmountMinor") FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')),0)::bigint AS gmv, COALESCE(SUM("platformCommissionMinor") FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')),0)::bigint AS commissions FROM "MarketplaceOrder"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*) FILTER (WHERE "startedAt">=CURRENT_DATE)::int AS "visitsToday", COUNT(DISTINCT "visitorId") FILTER (WHERE "startedAt">=CURRENT_DATE)::int AS "visitorsToday", COUNT(DISTINCT "visitorId") FILTER (WHERE "lastSeenAt">NOW()-INTERVAL '5 minutes')::int AS "onlineVisitors", COUNT(DISTINCT "userId") FILTER (WHERE "userId" IS NOT NULL AND "lastSeenAt">NOW()-INTERVAL '5 minutes')::int AS "onlineMembers" FROM "SiteAnalyticsSession"`),
    ]);
    return reply.send({
      kpis: {
        usersTotal: users[0]?.total ?? 0, usersToday: users[0]?.today ?? 0,
        listingsTotal: listings[0]?.total ?? 0, listingsPublished: listings[0]?.published ?? 0,
        ordersTotal: orders[0]?.total ?? 0, ordersActive: orders[0]?.active ?? 0,
        supportOpen: support[0]?.open ?? 0, moderationOpen: moderation[0]?.open ?? 0, disputesOpen: disputes[0]?.open ?? 0,
        gmvMinor: Number(finance[0]?.gmv ?? 0), platformCommissionMinor: Number(finance[0]?.commissions ?? 0),
        visitsToday: Number(audience[0]?.visitsToday ?? 0), visitorsToday: Number(audience[0]?.visitorsToday ?? 0), onlineVisitors: Number(audience[0]?.onlineVisitors ?? 0), onlineMembers: Number(audience[0]?.onlineMembers ?? 0),
      },
    });
  });

  app.get("/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","SUPPORT","COMPLIANCE"]); if (!admin) return;
    const q = String((request.query as any)?.q ?? "").trim();
    const users = await prisma.user.findMany({
      where: {
        roles: { none: { role: "SUPER_ADMIN" } },
        ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { profile: { is: { displayName: { contains: q, mode: "insensitive" as const } } } }] } : {}),
      },
      include: { profile: true, roles: true }, orderBy: { createdAt: "desc" }, take: 100,
    });
    const ids=users.map(u=>u.id);const reputation=ids.length?await prisma.$queryRawUnsafe<Array<{id:string;reviewCount:bigint;reviewAverage:number|null;completedSales:bigint;activeReports:bigint}>>(`SELECT u."id",COALESCE(rv."reviewCount",0)::bigint AS "reviewCount",rv."reviewAverage",COALESCE(os."completedSales",0)::bigint AS "completedSales",(COALESCE(ur."userReports",0)+COALESCE(mr."messageReports",0))::bigint AS "activeReports" FROM "User" u LEFT JOIN LATERAL (SELECT COUNT(*)::bigint AS "reviewCount",AVG(r."rating")::float AS "reviewAverage" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' WHERE r."revieweeId"=u."id") rv ON TRUE LEFT JOIN LATERAL (SELECT COUNT(*)::bigint AS "completedSales" FROM "MarketplaceOrder" o WHERE o."sellerId"=u."id" AND o."status"='COMPLETED') os ON TRUE LEFT JOIN LATERAL (SELECT COUNT(*)::bigint AS "userReports" FROM "TrustReport" tr WHERE tr."targetType"='USER' AND tr."targetId"=u."id" AND tr."status" NOT IN ('DISMISSED','CLOSED')) ur ON TRUE LEFT JOIN LATERAL (SELECT COUNT(*)::bigint AS "messageReports" FROM "TrustReport" tr JOIN "Message" m ON m."id"=tr."targetId" WHERE tr."targetType"='MESSAGE' AND m."senderId"=u."id" AND tr."status" NOT IN ('DISMISSED','CLOSED')) mr ON TRUE WHERE u."id"=ANY($1::text[])`,ids):[];const repMap=new Map(reputation.map(r=>[r.id,r]));
    return reply.send({ users: users.map((u) => {const r=repMap.get(u.id);return { id: u.id, email: u.email, kind: u.kind, status: u.status, emailVerifiedAt: u.emailVerifiedAt, displayName: u.profile?.displayName, firstName:u.profile?.firstName, lastName:u.profile?.lastName, phone:u.profile?.phone, roles: u.roles.map((x) => x.role), createdAt: u.createdAt, reputation:{reviewCount:Number(r?.reviewCount??0n),reviewAverage:r?.reviewAverage??null,completedSales:Number(r?.completedSales??0n),activeReports:Number(r?.activeReports??0n)}}}) });
  });

  app.post("/admin/users/:id/status", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN"]); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ status: z.enum(["ACTIVE","SUSPENDED","DELETED"]), reason: z.string().trim().min(5).max(1000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    if (admin.id === params.data.id && body.data.status !== "ACTIVE") return reply.code(409).send({ error: "cannot_suspend_self" });
    const targetRoles = await prisma.userAdminRole.findMany({ where: { userId: params.data.id }, select: { role: true } });
    if (targetRoles.some(entry => entry.role === "SUPER_ADMIN")) return reply.code(404).send({ error: "user_not_found" });
    const actorRoles = admin.roles.map((entry: { role: string }) => entry.role);
    if (!actorRoles.some((role:string)=>["SUPER_ADMIN","ADMIN"].includes(role))) return reply.code(403).send({ error: "forbidden" });
    await prisma.user.update({ where: { id: params.data.id }, data: { status: body.data.status } });
    if (body.data.status !== "ACTIVE") await prisma.session.updateMany({ where: { userId: params.data.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(admin.id, "USER_STATUS_CHANGED", "USER", params.data.id, body.data);
    return reply.send({ updated: true });
  });

  app.get("/admin/listings", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT"]); if (!admin) return;
    const query = z.object({
      q: z.string().trim().max(120).optional(),
      status: z.enum(["DRAFT","PENDING","PUBLISHED","SUSPENDED","SOLD","EXPIRED"]).optional(),
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });
    const q = query.data.q;
    const rows = await prisma.listing.findMany({
      where: {
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(q ? { OR: [
          { title: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
          { seller: { email: { contains: q, mode: "insensitive" } } },
        ] } : {}),
      },
      include: { seller: { select: { email: true, profile: { select: { displayName: true, firstName: true, lastName: true } }, stores:{select:{id:true,name:true,status:true}} } }, category: { select: { id:true,name: true, domain: true } } },
      orderBy: { createdAt: "desc" }, take: 150,
    });
    const ids = rows.map(row => row.id);
    const media = ids.length ? await prisma.$queryRawUnsafe<Array<{ listingId:string; publicUrl:string }>>(
      `SELECT DISTINCT ON ("listingId") "listingId","publicUrl" FROM "ListingMedia" WHERE "listingId" = ANY($1::text[]) AND "status"='READY' AND "publicUrl" IS NOT NULL ORDER BY "listingId","isCover" DESC,"sortOrder" ASC,"createdAt" ASC`, ids,
    ) : [];
    const mediaMap = new Map(media.map(item => [item.listingId, item.publicUrl] as const));
    return reply.send({ listings: rows.map((l) => ({
      id: l.id, slug: l.slug, title: l.title, description:l.description, status: l.status, priceMinor: l.priceMinor, currency: l.currency,
      sellerEmail: l.seller.email, sellerName: l.seller.profile?.displayName ?? ([l.seller.profile?.firstName,l.seller.profile?.lastName].filter(Boolean).join(" ") || l.seller.email),
      categoryId:l.category.id, category: l.category.name, domain: l.category.domain, city: l.city, postalCode: l.postalCode, region:l.region, storeId:l.storeId, sellerStores:l.seller.stores, coverUrl: mediaMap.get(l.id) ?? null, createdAt: l.createdAt, publishedAt: l.publishedAt,
    })) });
  });

  app.post("/admin/listings/:id/status", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","MODERATOR"]); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ status: z.enum(["PUBLISHED","SUSPENDED","EXPIRED"]), reason: z.string().trim().min(5).max(1000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findUnique({ where: { id: params.data.id }, select: { id: true, status: true, publishedAt:true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const publishedAt = body.data.status === "PUBLISHED" ? new Date() : null;
    await prisma.listing.update({ where: { id: listing.id }, data: { status: body.data.status, ...(publishedAt ? { publishedAt } : {}) } });
    if (publishedAt) {
      await activateListingLifetime(listing.id, publishedAt, true);
      if(listing.publishedAt==null)await notifyInstantSavedSearchesForListing(listing.id).catch(error=>request.log.warn({error,listingId:listing.id},"instant saved-search notification failed after admin publication"));
    }
    await audit(admin.id, "LISTING_STATUS_CHANGED", "LISTING", listing.id, { from: listing.status, to: body.data.status, reason: body.data.reason });
    return reply.send({ updated: true, status: body.data.status });
  });

  app.put("/admin/users/:id/roles", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN"]); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ roles: z.array(z.enum(["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","FINANCE","COMPLIANCE","MARKETING"])).max(7) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const user = await prisma.user.findUnique({ where: { id: params.data.id }, select: { id: true, roles: { select: { role: true } } } });
    if (!user || user.roles.some(entry => entry.role === "SUPER_ADMIN")) return reply.code(404).send({ error: "user_not_found" });
    if (user.roles.some(entry => entry.role === "SUPER_ADMIN") && !body.data.roles.includes("SUPER_ADMIN")) {
      const otherSuperAdmins = await prisma.userAdminRole.count({ where: { role: "SUPER_ADMIN", userId: { not: user.id } } });
      if (otherSuperAdmins === 0) return reply.code(409).send({ error: "cannot_remove_last_super_admin" });
    }
    await prisma.$transaction(async tx => {
      await tx.userAdminRole.deleteMany({ where: { userId: user.id } });
      if (body.data.roles.length) await tx.userAdminRole.createMany({ data: body.data.roles.map(role => ({ userId: user.id, role })) });
    });
    await audit(admin.id, "USER_ROLES_CHANGED", "USER", user.id, { roles: body.data.roles });
    return reply.send({ updated: true, roles: body.data.roles });
  });

  app.get("/admin/finance/orders", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","FINANCE","SUPPORT"]); if (!admin) return;
    await ensurePayoutReconciliationSchema();
    const payoutRuntime=await getPayoutProviderRuntime();
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`WITH base AS (
      SELECT o.*, p."status" AS "paymentStatus", p."providerPaymentId", p."capturedAt" AS "paymentCapturedAt", p."failureCode" AS "paymentFailureCode", p."failureMessage" AS "paymentFailureMessage", rf."status" AS "latestRefundStatus", rf."providerRefundId" AS "latestProviderRefundId", rf."amountMinor" AS "latestRefundAmountMinor", po."status" AS "payoutStatus", po."paidAt" AS "payoutPaidAt", po."failureReason" AS "payoutFailureReason", po."retryCount" AS "payoutRetryCount", po."lastProviderEvent" AS "payoutLastProviderEvent", po."lastProviderEventAt" AS "payoutLastProviderEventAt", bp."endsAt" AS "protectionEndsAt", bp."payoutEligibleAt", bp."confirmationStatus" AS "protectionStatus", s."status" AS "shipmentStatus", s."carrier", s."trackingNumber", s."estimatedDeliveryAt", s."lastCarrierEventAt", s."deliveredAt", cr."orderRiskScore", cr."paymentGate" AS "riskPaymentGate", cr."paymentResolution" AS "riskPaymentResolution", cr."payoutGate" AS "riskPayoutGate", cr."payoutResolution" AS "riskPayoutResolution",
      (o."status"='DISPUTED' OR EXISTS(SELECT 1 FROM "MarketplaceDispute" d WHERE d."orderId"=o."id" AND d."status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED'))) AS "activeDispute",
      EXISTS(SELECT 1 FROM "MarketplaceRefund" r WHERE r."orderId"=o."id" AND r."status" IN ('PENDING','PROCESSING')) AS "activeRefund",
      EXISTS(SELECT 1 FROM "MarketplacePayment" pr WHERE pr."orderId"=o."id" AND pr."status"='PARTIALLY_REFUNDED') AS "partialRefundReview",
      EXISTS(SELECT 1 FROM "MarketplaceReturnRequest" rr WHERE rr."orderId"=o."id" AND rr."status" IN ('OPEN','APPROVED','PROCESSING')) AS "activeReturn",
      CASE WHEN $1='mangopay' THEN EXISTS(SELECT 1 FROM "MarketplaceSellerPayoutProfile" msp WHERE msp."userId"=o."sellerId" AND msp."payoutsEnabled"=TRUE AND msp."kycLevel"='REGULAR' AND msp."recipientStatus"='ACTIVE') WHEN $1='stripe-connect' THEN EXISTS(SELECT 1 FROM "MarketplaceSellerAccount" msa WHERE msa."userId"=o."sellerId" AND msa."onboardingStatus"='ACTIVE' AND msa."payoutsEnabled"=TRUE AND msa."detailsSubmitted"=TRUE) ELSE FALSE END AS "sellerPaymentReady",
      (SELECT "kycLevel" FROM "MarketplaceSellerPayoutProfile" msp WHERE msp."userId"=o."sellerId" LIMIT 1) AS "sellerKycLevel",
      (SELECT "recipientStatus" FROM "MarketplaceSellerPayoutProfile" msp WHERE msp."userId"=o."sellerId" LIMIT 1) AS "sellerRecipientStatus",
      (SELECT "bankLast4" FROM "MarketplaceSellerPayoutProfile" msp WHERE msp."userId"=o."sellerId" LIMIT 1) AS "sellerBankLast4"
      FROM "MarketplaceOrder" o
      LEFT JOIN LATERAL (SELECT "status","providerPaymentId","capturedAt","failureCode","failureMessage" FROM "MarketplacePayment" WHERE "orderId"=o."id" ORDER BY "createdAt" DESC LIMIT 1) p ON TRUE
      LEFT JOIN LATERAL (SELECT "status","providerRefundId","amountMinor" FROM "MarketplaceRefund" WHERE "orderId"=o."id" ORDER BY "createdAt" DESC LIMIT 1) rf ON TRUE
      LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id"
      LEFT JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id"
      LEFT JOIN "MarketplaceShipment" s ON s."orderId"=o."id"
      LEFT JOIN "MarketplaceOrderRiskReview" cr ON cr."orderId"=o."id"
      ORDER BY o."createdAt" DESC LIMIT 100
    ) SELECT base.*,
      CASE
        WHEN "status"='CANCELED' THEN 'CANCELED'
        WHEN "status"='REFUNDED' THEN 'REFUNDED'
        WHEN "paymentStatus" IN ('FAILED','CANCELED') THEN 'PAYMENT_FAILED'
        WHEN "status"='PENDING_PAYMENT' THEN 'WAITING_PAYMENT'
        WHEN "activeDispute" THEN 'BLOCKED_DISPUTE'
        WHEN "activeReturn" THEN 'BLOCKED_RETURN'
        WHEN "activeRefund" THEN 'BLOCKED_REFUND'
        WHEN "partialRefundReview" THEN 'BLOCKED_PARTIAL_REFUND'
        WHEN "shipmentStatus" IN ('RETURNED','LOST','CANCELED','EXCEPTION') THEN 'BLOCKED_SHIPMENT'
        WHEN "status" IN ('PAID','PROCESSING') AND "shipmentStatus" IS NULL THEN 'WAITING_SHIPMENT'
        WHEN "shipmentStatus" IN ('LABEL_CREATED','IN_TRANSIT','OUT_FOR_DELIVERY') OR "status"='SHIPPED' THEN 'IN_TRANSIT'
        WHEN "status"='DELIVERED' AND "protectionEndsAt" > CURRENT_TIMESTAMP THEN 'PROTECTION_48H'
        WHEN "status"='DELIVERED' THEN 'PROTECTION_EXPIRED'
        WHEN "payoutStatus"='PROCESSING' THEN 'PAYOUT_PROCESSING'
        WHEN "payoutStatus"='PAID' THEN 'PAID'
        WHEN "payoutStatus"='FAILED' THEN 'PAYOUT_FAILED'
        WHEN "riskPayoutGate"='HOLD' AND COALESCE("riskPayoutResolution",'')<>'APPROVED' THEN 'BLOCKED_RISK_REVIEW'
        WHEN "payoutStatus"='BLOCKED' AND "payoutFailureReason"='SHIPMENT_NOT_DELIVERED' THEN 'BLOCKED_SHIPMENT'
        WHEN "payoutStatus"='BLOCKED' AND "payoutFailureReason"='PROVIDER_PENDING' THEN 'PROVIDER_PENDING'
        WHEN "status"='COMPLETED' AND "shipmentStatus" IS DISTINCT FROM 'DELIVERED' THEN 'BLOCKED_SHIPMENT'
        WHEN "status"='COMPLETED' AND $1='mangopay' AND COALESCE("sellerKycLevel",'LIGHT')<>'REGULAR' THEN 'WAITING_KYC'
        WHEN "status"='COMPLETED' AND $1='mangopay' AND COALESCE("sellerRecipientStatus",'NONE')<>'ACTIVE' THEN 'WAITING_IBAN'
        WHEN "status"='COMPLETED' AND NOT "sellerPaymentReady" THEN 'WAITING_PAYOUT_SETUP'
        WHEN "status"='COMPLETED' AND "payoutEligibleAt" IS NULL THEN 'SCHEDULE_MISSING'
        WHEN "status"='COMPLETED' AND "payoutEligibleAt" > CURRENT_TIMESTAMP THEN 'SCHEDULED'
        WHEN "status"='COMPLETED' AND "payoutEligibleAt" <= CURRENT_TIMESTAMP AND NOT $2::boolean THEN 'PROVIDER_PENDING'
        WHEN "status"='COMPLETED' AND "payoutEligibleAt" <= CURRENT_TIMESTAMP THEN 'READY'
        ELSE 'CHECK_REQUIRED'
      END AS "readinessState",
      ARRAY_REMOVE(ARRAY[
        CASE WHEN "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED') AND "paymentStatus" IS DISTINCT FROM 'CAPTURED' AND "paymentStatus" IS DISTINCT FROM 'PARTIALLY_REFUNDED' AND "paymentStatus" IS DISTINCT FROM 'REFUNDED' THEN 'ORDER_PAYMENT_MISMATCH' END,
        CASE WHEN "status" IN ('SHIPPED','DELIVERED','COMPLETED') AND "shipmentStatus" IS NULL THEN 'SHIPMENT_MISSING' END,
        CASE WHEN "status"='COMPLETED' AND "shipmentStatus" IS DISTINCT FROM 'DELIVERED' THEN 'COMPLETED_WITH_UNDELIVERED_SHIPMENT' END,
        CASE WHEN "status" IN ('DELIVERED','COMPLETED') AND "protectionEndsAt" IS NULL THEN 'PROTECTION_WINDOW_MISSING' END,
        CASE WHEN "payoutStatus"='PAID' AND "payoutPaidAt" IS NULL THEN 'PAYOUT_PAID_AT_MISSING' END,
        CASE WHEN "payoutStatus"='PAID' AND ("activeDispute" OR "activeReturn" OR "activeRefund" OR "partialRefundReview") THEN 'PAID_WHILE_BLOCKED' END,
        CASE WHEN "payoutStatus" IN ('PROCESSING','PAID') AND "shipmentStatus" IS DISTINCT FROM 'DELIVERED' THEN 'PAYOUT_WITH_UNDELIVERED_SHIPMENT' END,
        CASE WHEN "partialRefundReview" AND "payoutStatus" IN ('PROCESSING','PAID') THEN 'PARTIAL_REFUND_PAYOUT_RISK' END
      ],NULL) AS "reconciliationIssues"
    FROM base`,payoutRuntime.provider,payoutRuntime.operational);
    const issueCount = rows.reduce((sum,row)=>sum + (Array.isArray(row.reconciliationIssues) ? row.reconciliationIssues.length : 0),0);
    return reply.send({ orders: rows, reconciliation:{issueCount,checked:rows.length}, payoutProvider:payoutRuntime });
  });

  app.get("/admin/support/tickets", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","SUPPORT"]); if (!admin) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "SupportTicket" WHERE "status"<>'CLOSED' OR COALESCE("resolvedAt","updatedAt")>=CURRENT_TIMESTAMP-INTERVAL '48 hours' ORDER BY CASE WHEN "status"='CLOSED' THEN 2 ELSE 1 END, CASE "priority" WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, CASE WHEN "status"='CLOSED' THEN "resolvedAt" END DESC NULLS LAST, "lastMessageAt" ASC LIMIT 100`);
    return reply.send({ tickets: rows });
  });

  app.get("/admin/support/tickets/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","SUPPORT"]); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const tickets = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT t.*,u."email",u."kind"::text AS "userKind",p."displayName",p."firstName",p."lastName",p."phone" FROM "SupportTicket" t LEFT JOIN "User" u ON u."id"=t."userId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE t."id"=$1 LIMIT 1`, params.data.id);
    const ticket=tickets[0]; if(!ticket) return reply.code(404).send({error:"ticket_not_found"});
    const messages=await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","authorUserId","authorType"::text,"body","internalNote","createdAt" FROM "SupportTicketMessage" WHERE "ticketId"=$1 ORDER BY "createdAt" ASC`,params.data.id);
    const vacationIncidents=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT i.*,r."checkIn",r."checkOut",l."title" AS "listingTitle",l."city" FROM "VacationIncident" i JOIN "VacationReservationRequest" r ON r."id"=i."reservationId" JOIN "Listing" l ON l."id"=r."listingId" WHERE i."supportTicketId"=$1 LIMIT 1`,params.data.id).catch(()=>[]);
    const vacationIncident=vacationIncidents[0]??null;
    let vacationEvidence:Array<Record<string,unknown>>=[];let vacationPayout:Record<string,unknown>|null=null;
    if(vacationIncident){vacationEvidence=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","incidentId","uploadedById","fileName","mimeType","sizeBytes","createdAt" FROM "VacationIncidentEvidence" WHERE "incidentId"=$1 ORDER BY "createdAt" ASC`,vacationIncident.id).catch(()=>[]);const payoutRows=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "status","amountMinor","currency","failureReason","eligibleAt","paidAt" FROM "VacationDepositPayout" WHERE "reservationId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,vacationIncident.reservationId).catch(()=>[]);vacationPayout=payoutRows[0]??null;}
    return reply.send({ticket,messages,vacationIncident:vacationIncident?{...vacationIncident,evidence:vacationEvidence.map((e:any)=>({...e,downloadUrl:`/api/admin/vacation-incidents/${vacationIncident.id}/evidence/${e.id}/download`})),payout:vacationPayout}:null});
  });

  app.post("/admin/support/tickets/:id/reply", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","SUPPORT"]); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ body: z.string().trim().min(2).max(5000), internalNote: z.boolean().default(false), status: z.enum(["OPEN","PENDING_CUSTOMER","PENDING_INTERNAL","RESOLVED","CLOSED"]).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const current=await prisma.$queryRawUnsafe<Array<{id:string;status:string}>>(`SELECT "id","status"::text AS "status" FROM "SupportTicket" WHERE "id"=$1 LIMIT 1`,params.data.id);
    if(!current[0])return reply.code(404).send({error:"ticket_not_found"});
    if(!body.data.internalNote&&current[0].status==="CLOSED")return reply.code(409).send({error:"ticket_closed"});
    if (!body.data.internalNote && (body.data.status === "RESOLVED" || body.data.status === "CLOSED")) {
      const activeVacationIncident=await activeVacationSupportIncident(params.data.id);
      if(activeVacationIncident)return reply.code(409).send({error:"vacation_incident_resolution_required",incidentId:activeVacationIncident.id});
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicketMessage" ("id","ticketId","authorUserId","authorType","body","internalNote") VALUES ($1,$2,$3,'AGENT',$4,$5)`, randomUUID(), params.data.id, admin.id, body.data.body, body.data.internalNote);
    await prisma.$executeRawUnsafe(`UPDATE "SupportTicket" SET "assignedToUserId"=COALESCE("assignedToUserId",$1),"firstResponseAt"=COALESCE("firstResponseAt",CURRENT_TIMESTAMP),"lastMessageAt"=CURRENT_TIMESTAMP,"status"=COALESCE($2::"SupportTicketStatus","status"),"resolvedAt"=CASE WHEN $2 IN ('RESOLVED','CLOSED') THEN CURRENT_TIMESTAMP ELSE "resolvedAt" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`, admin.id, body.data.status ?? null, params.data.id);
    await audit(admin.id, "SUPPORT_REPLY", "SUPPORT_TICKET", params.data.id, { internalNote: body.data.internalNote, status: body.data.status });
    if (!body.data.internalNote && (body.data.status === "RESOLVED" || body.data.status === "CLOSED")) {
      try { await publishFaqFromResolvedTicket(params.data.id); } catch (error) { request.log.warn({error,ticketId:params.data.id},"support_faq_publish_failed"); }
    }
    if (!body.data.internalNote) {
      const tickets = await prisma.$queryRawUnsafe<Array<{userId:string;reference:string;subject:string}>>(`SELECT "userId","reference","subject" FROM "SupportTicket" WHERE "id"=$1 LIMIT 1`, params.data.id);
      const ticket = tickets[0];
      if (ticket) await deliverUserEvent({userId:ticket.userId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Réponse du service client",body:`Une nouvelle réponse est disponible pour votre demande ${ticket.reference} : ${ticket.subject}.`,actionUrl:`/assistance?ticket=${encodeURIComponent(params.data.id)}`,metadata:{supportTicketId:params.data.id,reference:ticket.reference}});
    }
    return reply.send({ replied: true });
  });

  app.post("/admin/support/tickets/:id/close", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","SUPPORT"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const tickets=await prisma.$queryRawUnsafe<Array<{id:string;userId:string;reference:string;subject:string;status:string}>>(`SELECT "id","userId","reference","subject","status"::text AS "status" FROM "SupportTicket" WHERE "id"=$1 LIMIT 1`,params.data.id);
    const ticket=tickets[0];if(!ticket)return reply.code(404).send({error:"ticket_not_found"});
    const incident=await activeVacationSupportIncident(ticket.id);if(incident)return reply.code(409).send({error:"vacation_incident_resolution_required",incidentId:incident.id});
    const closed=await closeSupportTicket(ticket.id,"Cette demande a été fermée par le service client. Si vous avez encore besoin d’aide, vous pouvez ouvrir une nouvelle demande depuis le centre d’aide.");
    if(closed){await prisma.$executeRawUnsafe(`UPDATE "SupportTicket" SET "assignedToUserId"=COALESCE("assignedToUserId",$1) WHERE "id"=$2`,admin.id,ticket.id);await audit(admin.id,"SUPPORT_TICKET_CLOSED","SUPPORT_TICKET",ticket.id,{previousStatus:ticket.status});await deliverUserEvent({userId:ticket.userId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Demande d’assistance fermée",body:`Votre demande ${ticket.reference} a été fermée par le service client.`,actionUrl:`/assistance?ticket=${encodeURIComponent(ticket.id)}`,metadata:{supportTicketId:ticket.id,reference:ticket.reference}}).catch(()=>undefined);}
    return reply.send({closed:true,alreadyClosed:!closed});
  });


  app.patch("/admin/users/:id", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN"]); if (!admin) return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({email:z.string().trim().toLowerCase().email(),kind:z.enum(["PARTICULIER","PROFESSIONNEL"]),displayName:z.string().trim().max(80).nullable().optional(),firstName:z.string().trim().max(80).nullable().optional(),lastName:z.string().trim().max(80).nullable().optional(),phone:z.string().trim().max(40).nullable().optional(),emailVerified:z.boolean().optional()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const target=await prisma.user.findUnique({where:{id:params.data.id},include:{roles:true}});if(!target||target.roles.some(r=>r.role==="SUPER_ADMIN"))return reply.code(404).send({error:"user_not_found"});
    try{
      const updated=await prisma.$transaction(async tx=>{
        const user=await tx.user.update({where:{id:target.id},data:{email:body.data.email,kind:body.data.kind,...(typeof body.data.emailVerified==="boolean"?{emailVerifiedAt:body.data.emailVerified?(target.emailVerifiedAt??new Date()):null}:{})}});
        const profile=await tx.userProfile.upsert({where:{userId:target.id},create:{userId:target.id,displayName:body.data.displayName??null,firstName:body.data.firstName??null,lastName:body.data.lastName??null,phone:body.data.phone??null},update:{displayName:body.data.displayName??null,firstName:body.data.firstName??null,lastName:body.data.lastName??null,phone:body.data.phone??null}});
        return{user,profile};
      });
      await audit(admin.id,"USER_PROFILE_UPDATED","USER",target.id,{email:body.data.email,kind:body.data.kind,emailVerified:body.data.emailVerified});
      return reply.send({updated:true,user:updated.user,profile:updated.profile});
    }catch(error:any){if(String(error?.code)==="P2002")return reply.code(409).send({error:"email_already_used"});request.log.error(error);return reply.code(500).send({error:"update_failed"});}
  });

  app.patch("/admin/listings/:id", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","MODERATOR"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({title:z.string().trim().min(5).max(120),description:z.string().trim().min(20).max(12000),price:z.number().nonnegative().nullable(),city:z.string().trim().max(100).nullable(),postalCode:z.string().trim().max(20).nullable(),region:z.string().trim().max(120).nullable(),categoryId:z.string().min(1),storeId:z.string().nullable().optional()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const listing=await prisma.listing.findUnique({where:{id:params.data.id},select:{id:true,sellerId:true}});if(!listing)return reply.code(404).send({error:"listing_not_found"});
    const category=await prisma.category.findUnique({where:{id:body.data.categoryId},select:{id:true}});if(!category)return reply.code(400).send({error:"category_not_found"});
    if(body.data.storeId){const store=await prisma.store.findFirst({where:{id:body.data.storeId,ownerId:listing.sellerId},select:{id:true}});if(!store)return reply.code(400).send({error:"store_not_owned_by_seller"});}
    const updated=await prisma.listing.update({where:{id:listing.id},data:{title:body.data.title,description:body.data.description,priceMinor:body.data.price==null?null:Math.round(body.data.price*100),city:body.data.city||null,postalCode:body.data.postalCode||null,region:body.data.region||null,categoryId:body.data.categoryId,...(body.data.storeId!==undefined?{storeId:body.data.storeId||null}:{})}});
    await audit(admin.id,"LISTING_CONTENT_UPDATED","LISTING",listing.id,{fields:["title","description","price","location","category","store"]});
    return reply.send({updated:true,listing:updated});
  });

  app.delete("/admin/listings/:id", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({reason:z.string().trim().min(5).max(1000),confirmation:z.literal("SUPPRIMER")}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const listing=await prisma.listing.findUnique({where:{id:params.data.id},select:{id:true,title:true,status:true,sellerId:true,slug:true}});
    if(!listing)return reply.code(404).send({error:"listing_not_found"});
    const orders=await prisma.$queryRawUnsafe<Array<{count:number}>>(`SELECT COUNT(*)::int AS count FROM "MarketplaceOrder" WHERE "listingId"=$1`,listing.id);
    if(Number(orders[0]?.count??0)>0)return reply.code(409).send({error:"listing_has_orders",message:"Cette annonce possède un historique de commande et ne peut pas être supprimée définitivement."});
    const media=await prisma.$queryRawUnsafe<Array<{objectKey:string}>>(`SELECT "objectKey" FROM "ListingMedia" WHERE "listingId"=$1`,listing.id).catch(()=>[]);
    await prisma.listing.delete({where:{id:listing.id}});
    await audit(admin.id,"LISTING_DELETED","LISTING",listing.id,{title:listing.title,status:listing.status,slug:listing.slug,reason:body.data.reason,mediaCount:media.length});
    await deliverUserEvent({userId:listing.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Annonce supprimée par l’administration",body:`Votre annonce « ${listing.title||"Sans titre"} » a été supprimée. Motif : ${body.data.reason}.`,actionUrl:"/mon-compte/annonces",metadata:{listingId:listing.id,adminDeleted:true,reason:body.data.reason}}).catch(()=>undefined);
    for(const item of media)void deleteStoredObject(item.objectKey).catch(()=>undefined);
    return reply.send({deleted:true,id:listing.id});
  });

  app.get("/admin/professionals", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","SUPPORT","COMPLIANCE"]);if(!admin)return;
    const q=String((request.query as any)?.q??"").trim();
    const rows=await prisma.user.findMany({where:{kind:"PROFESSIONNEL",roles:{none:{role:"SUPER_ADMIN"}},...(q?{OR:[{email:{contains:q,mode:"insensitive" as const}},{profile:{is:{displayName:{contains:q,mode:"insensitive" as const}}}},{business:{is:{tradeName:{contains:q,mode:"insensitive" as const}}}},{business:{is:{legalName:{contains:q,mode:"insensitive" as const}}}}]}:{})},include:{profile:true,business:true,stores:{include:{_count:{select:{listings:true}}},orderBy:{createdAt:"asc"}},subscriptions:{include:{plan:true},orderBy:{createdAt:"desc"},take:1}},orderBy:{createdAt:"desc"},take:100});
    return reply.send({professionals:rows.map(u=>({id:u.id,email:u.email,status:u.status,displayName:u.profile?.displayName??null,business:u.business,stores:u.stores.map(s=>({...s,listingCount:s._count.listings})),subscription:u.subscriptions[0]??null,createdAt:u.createdAt}))});
  });

  app.patch("/admin/professionals/:id", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","COMPLIANCE"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({legalName:z.string().trim().min(2).max(180),tradeName:z.string().trim().max(180).nullable(),siren:z.string().trim().max(20).nullable(),siret:z.string().trim().max(20).nullable(),vatNumber:z.string().trim().max(40).nullable(),legalForm:z.string().trim().max(80).nullable(),nafCode:z.string().trim().max(20).nullable(),headquartersAddress:z.string().trim().max(240).nullable(),headquartersPostalCode:z.string().trim().max(20).nullable(),headquartersCity:z.string().trim().max(100).nullable(),verificationStatus:z.enum(["NOT_STARTED","PENDING","VERIFIED","REJECTED"])}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const user=await prisma.user.findFirst({where:{id:params.data.id,kind:"PROFESSIONNEL"},select:{id:true}});if(!user)return reply.code(404).send({error:"professional_not_found"});
    try{const business=await prisma.businessProfile.upsert({where:{userId:user.id},create:{userId:user.id,legalName:body.data.legalName,tradeName:body.data.tradeName||null,siren:body.data.siren||null,siret:body.data.siret||null,vatNumber:body.data.vatNumber||null,legalForm:body.data.legalForm||null,nafCode:body.data.nafCode||null,headquartersAddress:body.data.headquartersAddress||null,headquartersPostalCode:body.data.headquartersPostalCode||null,headquartersCity:body.data.headquartersCity||null,verificationStatus:body.data.verificationStatus,verifiedAt:body.data.verificationStatus==="VERIFIED"?new Date():null},update:{legalName:body.data.legalName,tradeName:body.data.tradeName||null,siren:body.data.siren||null,siret:body.data.siret||null,vatNumber:body.data.vatNumber||null,legalForm:body.data.legalForm||null,nafCode:body.data.nafCode||null,headquartersAddress:body.data.headquartersAddress||null,headquartersPostalCode:body.data.headquartersPostalCode||null,headquartersCity:body.data.headquartersCity||null,verificationStatus:body.data.verificationStatus,verifiedAt:body.data.verificationStatus==="VERIFIED"?new Date():null}});await audit(admin.id,"PROFESSIONAL_PROFILE_UPDATED","USER",user.id,{verificationStatus:body.data.verificationStatus});return reply.send({updated:true,business});}catch(error:any){if(String(error?.code)==="P2002")return reply.code(409).send({error:"business_identifier_already_used"});request.log.error(error);return reply.code(500).send({error:"update_failed"});}
  });

  app.patch("/admin/stores/:id", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","SUPPORT"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({name:z.string().trim().min(2).max(120),slug:z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),description:z.string().trim().max(3000).nullable(),websiteUrl:z.union([z.string().url(),z.literal("")]).nullable(),phone:z.string().trim().max(40).nullable(),email:z.union([z.string().email(),z.literal("")]).nullable(),city:z.string().trim().max(100).nullable(),postalCode:z.string().trim().max(20).nullable(),countryCode:z.string().trim().length(2),status:z.enum(["DRAFT","ACTIVE","SUSPENDED"]),isVerified:z.boolean(),reason:z.string().trim().max(500).optional()}).superRefine((v,ctx)=>{if(v.status==="SUSPENDED"&&(!v.reason||v.reason.length<5))ctx.addIssue({code:"custom",message:"suspension_reason_required",path:["reason"]})}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const existing=await prisma.store.findUnique({where:{id:params.data.id},select:{id:true,status:true}});if(!existing)return reply.code(404).send({error:"store_not_found"});
    try{const store=await prisma.store.update({where:{id:existing.id},data:{name:body.data.name,slug:body.data.slug,description:body.data.description||null,websiteUrl:body.data.websiteUrl||null,phone:body.data.phone||null,email:body.data.email||null,city:body.data.city||null,postalCode:body.data.postalCode||null,countryCode:body.data.countryCode.toUpperCase(),status:body.data.status,isVerified:body.data.isVerified,publishedAt:body.data.status==="ACTIVE"?(existing.status==="ACTIVE"?undefined:new Date()):undefined}});await audit(admin.id,"STORE_UPDATED","STORE",store.id,{status:body.data.status,isVerified:body.data.isVerified,reason:body.data.reason??null});if(body.data.status==="SUSPENDED"){const owner=await prisma.store.findUnique({where:{id:store.id},select:{ownerId:true}});if(owner)await deliverUserEvent({userId:owner.ownerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Vitrine suspendue",body:`Votre vitrine « ${store.name} » a été suspendue. Motif : ${body.data.reason}.`,actionUrl:"/espace-pro/boutiques",metadata:{storeId:store.id,reason:body.data.reason}})}return reply.send({updated:true,store});}catch(error:any){if(String(error?.code)==="P2002")return reply.code(409).send({error:"store_slug_already_used"});request.log.error(error);return reply.code(500).send({error:"update_failed"});}
  });


  app.get("/admin/users/:id/detail", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","SUPPORT","COMPLIANCE","MODERATOR"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const user=await prisma.user.findUnique({where:{id:params.data.id},include:{profile:true,business:true,stores:{include:{_count:{select:{listings:true}}},orderBy:{createdAt:"asc"}},subscriptions:{include:{plan:true},orderBy:{createdAt:"desc"},take:5},roles:true}});
    if(!user||user.roles.some(r=>r.role==="SUPER_ADMIN"))return reply.code(404).send({error:"user_not_found"});
    const [listings,orders,tickets,reportsReceived,reportsCreated,walletRows]=await Promise.all([
      prisma.listing.findMany({where:{sellerId:user.id},select:{id:true,title:true,slug:true,status:true,priceMinor:true,currency:true,city:true,createdAt:true,publishedAt:true,category:{select:{name:true}},store:{select:{id:true,name:true}}},orderBy:{createdAt:"desc"},take:50}),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT o."id",o."orderNumber",o."listingId",o."buyerId",o."sellerId",o."status",o."totalAmountMinor",o."sellerNetMinor",o."currency",o."createdAt",l."title" FROM "MarketplaceOrder" o LEFT JOIN "Listing" l ON l."id"=o."listingId" WHERE o."buyerId"=$1 OR o."sellerId"=$1 ORDER BY o."createdAt" DESC LIMIT 50`,user.id),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","reference","category","subject","status","priority","lastMessageAt","createdAt" FROM "SupportTicket" WHERE "userId"=$1 ORDER BY "lastMessageAt" DESC LIMIT 50`,user.id),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","targetType"::text AS "targetType","targetId","reason"::text AS "reason","details","status"::text AS "status","createdAt" FROM "TrustReport" WHERE ("targetType"='USER' AND "targetId"=$1) OR ("targetType"='MESSAGE' AND "targetId" IN (SELECT "id" FROM "Message" WHERE "senderId"=$1)) ORDER BY "createdAt" DESC LIMIT 50`,user.id),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","targetType"::text AS "targetType","targetId","reason"::text AS "reason","details","status"::text AS "status","createdAt" FROM "TrustReport" WHERE "reporterId"=$1 ORDER BY "createdAt" DESC LIMIT 50`,user.id),
      prisma.$queryRawUnsafe<Array<{balanceMinor:number;currency:string}>>(`SELECT "balanceMinor","currency" FROM "SiteCreditWallet" WHERE "userId"=$1 LIMIT 1`,user.id).catch(()=>[]),
    ]);
    const [reputation,reputationHistory]=await Promise.all([getUserReputation(user.id),getReputationBadgeHistory(user.id,30)]);
    const reputationPayload=reputation?{...reputation,history:reputationHistory}:null;
    return reply.send({user:{id:user.id,email:user.email,kind:user.kind,status:user.status,emailVerifiedAt:user.emailVerifiedAt,lastLoginAt:user.lastLoginAt,createdAt:user.createdAt,profile:user.profile,business:user.business,roles:user.roles.map(r=>r.role),reputation:reputationPayload},wallet:walletRows[0]??{balanceMinor:0,currency:"EUR"},stores:user.stores.map(x=>({...x,listingCount:x._count.listings})),subscriptions:user.subscriptions,listings,orders,tickets,reportsReceived,reportsCreated});
  });

  app.get("/admin/listings/:id/detail", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","COMPLIANCE"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const listing=await prisma.listing.findUnique({where:{id:params.data.id},include:{seller:{include:{profile:true,business:true}},category:true,store:true,vehicle:true,property:true,energy:true,attributes:{include:{attribute:true}}}});
    if(!listing)return reply.code(404).send({error:"listing_not_found"});
    const [media,orders,reports]=await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","publicUrl","isCover","sortOrder","mimeType","createdAt" FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY' ORDER BY "isCover" DESC,"sortOrder" ASC,"createdAt" ASC`,listing.id),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","orderNumber","buyerId","sellerId","status","totalAmountMinor","sellerNetMinor","currency","createdAt" FROM "MarketplaceOrder" WHERE "listingId"=$1 ORDER BY "createdAt" DESC LIMIT 50`,listing.id),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","reporterId","reason"::text AS "reason","details","status"::text AS "status","createdAt" FROM "TrustReport" WHERE "targetType"='LISTING' AND "targetId"=$1 ORDER BY "createdAt" DESC LIMIT 50`,listing.id),
    ]);
    return reply.send({listing,media,orders,reports});
  });

  app.get("/admin/professionals/:id/detail", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","SUPPORT","COMPLIANCE"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const user=await prisma.user.findFirst({where:{id:params.data.id,kind:"PROFESSIONNEL"},include:{profile:true,business:true,stores:{include:{_count:{select:{listings:true}}},orderBy:{createdAt:"asc"}},subscriptions:{include:{plan:true},orderBy:{createdAt:"desc"},take:10}}});
    if(!user)return reply.code(404).send({error:"professional_not_found"});
    const [listings,sales,tickets,reviews,plans]=await Promise.all([
      prisma.listing.findMany({where:{sellerId:user.id},select:{id:true,title:true,slug:true,status:true,priceMinor:true,currency:true,city:true,createdAt:true,store:{select:{id:true,name:true}},category:{select:{name:true}}},orderBy:{createdAt:"desc"},take:100}),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT o."id",o."orderNumber",o."listingId",o."status",o."totalAmountMinor",o."sellerNetMinor",o."currency",o."createdAt",l."title" FROM "MarketplaceOrder" o LEFT JOIN "Listing" l ON l."id"=o."listingId" WHERE o."sellerId"=$1 ORDER BY o."createdAt" DESC LIMIT 100`,user.id),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","reference","category","subject","status","priority","lastMessageAt","createdAt" FROM "SupportTicket" WHERE "userId"=$1 ORDER BY "lastMessageAt" DESC LIMIT 50`,user.id),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","rating","comment","direction"::text AS "direction","createdAt" FROM "MarketplaceReview" WHERE "revieweeId"=$1 ORDER BY "createdAt" DESC LIMIT 50`,user.id),
      prisma.professionalPlan.findMany({where:{isActive:true},orderBy:{monthlyPriceMinor:"asc"}}),
    ]);
    const totalNet=sales.reduce((sum,row)=>sum+Number(row.sellerNetMinor??0),0);
    return reply.send({professional:{id:user.id,email:user.email,status:user.status,createdAt:user.createdAt,profile:user.profile,business:user.business},plans,stores:user.stores.map(x=>({...x,listingCount:x._count.listings})),subscriptions:user.subscriptions,listings,sales,tickets,reviews,summary:{listings:listings.length,stores:user.stores.length,sales:sales.length,totalNetMinor:totalNet}});
  });



  app.post("/admin/users/:id/notify", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","SUPPORT","MARKETING"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({title:z.string().trim().min(3).max(120),body:z.string().trim().min(5).max(2000),actionUrl:z.string().trim().max(500).optional()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const user=await prisma.user.findUnique({where:{id:params.data.id},include:{roles:true}});if(!user||user.roles.some(r=>r.role==="SUPER_ADMIN"))return reply.code(404).send({error:"user_not_found"});
    await deliverUserEvent({userId:user.id,eventKind:"LISTING",notificationKind:"SYSTEM",title:body.data.title,body:body.data.body,actionUrl:body.data.actionUrl||"/mon-compte/notifications",metadata:{adminMessage:true,actorUserId:admin.id}});
    await audit(admin.id,"ADMIN_USER_NOTIFICATION","USER",user.id,{title:body.data.title,actionUrl:body.data.actionUrl||null});
    return reply.send({sent:true});
  });

  app.post("/admin/listings/bulk-status", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN","MODERATOR"]);if(!admin)return;
    const body=z.object({ids:z.array(z.string().min(1)).min(1).max(100),status:z.enum(["PUBLISHED","SUSPENDED","EXPIRED"]),reason:z.string().trim().min(5).max(1000)}).safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:"invalid_request"});
    const unique=[...new Set(body.data.ids)];const rows=await prisma.listing.findMany({where:{id:{in:unique}},select:{id:true,status:true,publishedAt:true}});if(!rows.length)return reply.code(404).send({error:"listings_not_found"});
    const now=new Date();await prisma.$transaction(async tx=>{for(const row of rows){await tx.listing.update({where:{id:row.id},data:{status:body.data.status,...(body.data.status==="PUBLISHED"?{publishedAt:now}:{})}})}});
    if(body.data.status==="PUBLISHED")for(const row of rows){await activateListingLifetime(row.id,now,true);if(row.publishedAt==null)await notifyInstantSavedSearchesForListing(row.id).catch(error=>request.log.warn({error,listingId:row.id},"instant saved-search notification failed after bulk admin publication"));}
    await audit(admin.id,"LISTING_BULK_STATUS_CHANGED","LISTING",undefined,{ids:rows.map(r=>r.id),status:body.data.status,reason:body.data.reason,count:rows.length});
    return reply.send({updated:rows.length,status:body.data.status});
  });

  app.post("/admin/professionals/:id/subscription", async (request, reply) => {
    const admin=await requireAdmin(request,reply,["SUPER_ADMIN","ADMIN"]);if(!admin)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({planId:z.string().min(1),status:z.enum(["TRIALING","ACTIVE","PAST_DUE","CANCELED"]).default("ACTIVE"),extendDays:z.number().int().min(0).max(3650).default(0),reason:z.string().trim().min(5).max(500)}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const [user,plan]=await Promise.all([prisma.user.findFirst({where:{id:params.data.id,kind:"PROFESSIONNEL"},select:{id:true}}),prisma.professionalPlan.findUnique({where:{id:body.data.planId}})]);if(!user)return reply.code(404).send({error:"professional_not_found"});if(!plan)return reply.code(400).send({error:"plan_not_found"});
    const current=await prisma.professionalSubscription.findFirst({where:{userId:user.id},orderBy:{createdAt:"desc"}});const now=new Date();let end=current?.currentPeriodEnd??null;if(body.data.extendDays>0){const base=end&&end>now?end:now;end=new Date(base.getTime()+body.data.extendDays*86400000)}else if(!current){end=new Date(now.getTime()+30*86400000)}
    const subscription=current?await prisma.professionalSubscription.update({where:{id:current.id},data:{planId:plan.id,status:body.data.status,currentPeriodStart:current.currentPeriodStart??now,currentPeriodEnd:end}}):await prisma.professionalSubscription.create({data:{userId:user.id,planId:plan.id,status:body.data.status,currentPeriodStart:now,currentPeriodEnd:end}});
    await audit(admin.id,"PRO_SUBSCRIPTION_OVERRIDE","USER",user.id,{subscriptionId:subscription.id,planId:plan.id,status:body.data.status,extendDays:body.data.extendDays,reason:body.data.reason,externalManaged:Boolean(current?.externalSubscriptionId)});
    await deliverUserEvent({userId:user.id,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Mise à jour de votre abonnement Pro",body:`Votre formule Petit Annonces Pro est maintenant « ${plan.name} »${body.data.extendDays>0?` et votre accès a été prolongé de ${body.data.extendDays} jour${body.data.extendDays>1?"s":""}.`:"."}`,actionUrl:"/espace-pro/abonnement",metadata:{planId:plan.id,status:body.data.status,extendDays:body.data.extendDays}});
    return reply.send({updated:true,subscription,plan,externalManaged:Boolean(current?.externalSubscriptionId)});
  });

  app.get("/admin/analytics/daily", async (request, reply) => {
    const admin = await requireAdmin(request, reply); if (!admin) return;
    const days = Math.min(365, Math.max(7, Number((request.query as any)?.days ?? 30)));
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "DailyMarketplaceMetric" WHERE "date" >= CURRENT_DATE - $1::int ORDER BY "date" ASC`, days);
    return reply.send({ metrics: rows });
  });

  app.post("/internal/support/auto-close", async (request, reply) => {
    const secret=String(request.headers["x-internal-secret"]??"");if(!process.env.INTERNAL_CRON_SECRET||secret!==process.env.INTERNAL_CRON_SECRET)return reply.code(401).send({error:"unauthorized"});
    const due=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT t."id" FROM "SupportTicket" t WHERE t."status"='PENDING_CUSTOMER' AND t."lastMessageAt" <= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 hour') AND NOT EXISTS (SELECT 1 FROM "VacationIncident" i WHERE i."supportTicketId"=t."id" AND i."status" IN ('OPEN','UNDER_REVIEW')) ORDER BY t."lastMessageAt" ASC LIMIT 200`,SUPPORT_AUTO_CLOSE_HOURS);
    let closed=0;for(const ticket of due){if(await closeSupportTicket(ticket.id,SUPPORT_AUTO_CLOSE_MESSAGE))closed++;}
    return reply.send({processed:due.length,closed,thresholdHours:SUPPORT_AUTO_CLOSE_HOURS});
  });

  app.post("/internal/analytics/rollup", async (request, reply) => {
    const secret = String(request.headers["x-internal-secret"] ?? "");
    if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) return reply.code(401).send({ error: "unauthorized" });
    await prisma.$executeRawUnsafe(`INSERT INTO "DailyMarketplaceMetric" ("date","newUsers","newListings","publishedListings","orders","paidOrders","gmvMinor","platformRevenueMinor","refundsMinor","payoutsMinor","disputesOpened","supportTicketsOpened","moderationCasesOpened") SELECT CURRENT_DATE, (SELECT COUNT(*)::int FROM "User" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "Listing" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "Listing" WHERE "publishedAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "MarketplaceOrder" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "MarketplaceOrder" WHERE "paidAt"::date=CURRENT_DATE), COALESCE((SELECT SUM("totalAmountMinor") FROM "MarketplaceOrder" WHERE "paidAt"::date=CURRENT_DATE),0), COALESCE((SELECT SUM("platformCommissionMinor") FROM "MarketplaceOrder" WHERE "paidAt"::date=CURRENT_DATE),0), COALESCE((SELECT SUM("amountMinor") FROM "MarketplaceRefund" WHERE "createdAt"::date=CURRENT_DATE AND "status"='SUCCEEDED'),0), COALESCE((SELECT SUM("amountMinor") FROM "MarketplacePayout" WHERE "paidAt"::date=CURRENT_DATE),0), (SELECT COUNT(*)::int FROM "MarketplaceDispute" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "SupportTicket" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "ModerationCase" WHERE "createdAt"::date=CURRENT_DATE) ON CONFLICT ("date") DO UPDATE SET "newUsers"=EXCLUDED."newUsers","newListings"=EXCLUDED."newListings","publishedListings"=EXCLUDED."publishedListings","orders"=EXCLUDED."orders","paidOrders"=EXCLUDED."paidOrders","gmvMinor"=EXCLUDED."gmvMinor","platformRevenueMinor"=EXCLUDED."platformRevenueMinor","refundsMinor"=EXCLUDED."refundsMinor","payoutsMinor"=EXCLUDED."payoutsMinor","disputesOpened"=EXCLUDED."disputesOpened","supportTicketsOpened"=EXCLUDED."supportTicketsOpened","moderationCasesOpened"=EXCLUDED."moderationCasesOpened","updatedAt"=CURRENT_TIMESTAMP`);
    return reply.send({ rolledUp: true });
  });
}
