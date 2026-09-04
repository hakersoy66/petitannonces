import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const ADMIN_ROLES = new Set(["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","FINANCE","COMPLIANCE","MARKETING"]);

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function currentUser(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
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

export async function registerOperationsRoutes(app: FastifyInstance) {
  app.post("/support/tickets", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ category: z.enum(["ACCOUNT","LISTING","PAYMENT","ORDER","SHIPPING","DISPUTE","PROFESSIONAL","COMPLIANCE","SAFETY","OTHER"]), subject: z.string().trim().min(4).max(180), body: z.string().trim().min(10).max(5000), orderId: z.string().optional(), listingId: z.string().optional(), conversationId: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const id = randomUUID();
    const reference = `SUP-${Date.now().toString(36).toUpperCase()}-${id.slice(0,6).toUpperCase()}`;
    await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicket" ("id","reference","userId","category","subject","orderId","listingId","conversationId") VALUES ($1,$2,$3,$4::"SupportTicketCategory",$5,$6,$7,$8)`, id, reference, user.id, parsed.data.category, parsed.data.subject, parsed.data.orderId ?? null, parsed.data.listingId ?? null, parsed.data.conversationId ?? null);
    await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicketMessage" ("id","ticketId","authorUserId","authorType","body") VALUES ($1,$2,$3,'CUSTOMER',$4)`, randomUUID(), id, user.id, parsed.data.body);
    return reply.code(201).send({ ticket: { id, reference, status: "OPEN" } });
  });

  app.get("/support/tickets", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","reference","category","subject","status","priority","lastMessageAt","createdAt" FROM "SupportTicket" WHERE "userId"=$1 ORDER BY "lastMessageAt" DESC LIMIT 100`, user.id);
    return reply.send({ tickets: rows });
  });

  app.get("/admin/dashboard", async (request, reply) => {
    const admin = await requireAdmin(request, reply); if (!admin) return;
    const [users, listings, orders, support, moderation, disputes, finance] = await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "createdAt" >= CURRENT_DATE)::int AS today FROM "User"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "status"='PUBLISHED')::int AS published FROM "Listing"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED'))::int AS active FROM "MarketplaceOrder"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*) FILTER (WHERE "status" NOT IN ('RESOLVED','CLOSED'))::int AS open FROM "SupportTicket"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*) FILTER (WHERE "status" NOT IN ('RESOLVED','CLOSED'))::int AS open FROM "ModerationCase"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(*) FILTER (WHERE "status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED'))::int AS open FROM "MarketplaceDispute"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT COALESCE(SUM("totalAmountMinor") FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')),0)::bigint AS gmv, COALESCE(SUM("platformCommissionMinor") FILTER (WHERE "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')),0)::bigint AS commissions FROM "MarketplaceOrder"`),
    ]);
    return reply.send({
      kpis: {
        usersTotal: users[0]?.total ?? 0, usersToday: users[0]?.today ?? 0,
        listingsTotal: listings[0]?.total ?? 0, listingsPublished: listings[0]?.published ?? 0,
        ordersTotal: orders[0]?.total ?? 0, ordersActive: orders[0]?.active ?? 0,
        supportOpen: support[0]?.open ?? 0, moderationOpen: moderation[0]?.open ?? 0, disputesOpen: disputes[0]?.open ?? 0,
        gmvMinor: Number(finance[0]?.gmv ?? 0), platformCommissionMinor: Number(finance[0]?.commissions ?? 0),
      },
    });
  });

  app.get("/admin/users", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","SUPPORT","COMPLIANCE"]); if (!admin) return;
    const q = String((request.query as any)?.q ?? "").trim();
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { profile: { is: { displayName: { contains: q, mode: "insensitive" } } } }] } : undefined,
      include: { profile: true, roles: true }, orderBy: { createdAt: "desc" }, take: 100,
    });
    return reply.send({ users: users.map((u) => ({ id: u.id, email: u.email, kind: u.kind, status: u.status, emailVerifiedAt: u.emailVerifiedAt, displayName: u.profile?.displayName, roles: u.roles.map((r) => r.role), createdAt: u.createdAt })) });
  });

  app.post("/admin/users/:id/status", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN"]); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ status: z.enum(["ACTIVE","SUSPENDED","DELETED"]), reason: z.string().trim().min(5).max(1000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.user.update({ where: { id: params.data.id }, data: { status: body.data.status } });
    if (body.data.status !== "ACTIVE") await prisma.session.updateMany({ where: { userId: params.data.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(admin.id, "USER_STATUS_CHANGED", "USER", params.data.id, body.data);
    return reply.send({ updated: true });
  });

  app.get("/admin/listings", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT"]); if (!admin) return;
    const rows = await prisma.listing.findMany({ include: { seller: { select: { email: true } }, category: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return reply.send({ listings: rows.map((l) => ({ id: l.id, title: l.title, status: l.status, priceMinor: l.priceMinor, currency: l.currency, sellerEmail: l.seller.email, category: l.category.name, city: l.city, createdAt: l.createdAt })) });
  });

  app.get("/admin/finance/orders", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","FINANCE","SUPPORT"]); if (!admin) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT o.*, p."status" AS "paymentStatus", po."status" AS "payoutStatus" FROM "MarketplaceOrder" o LEFT JOIN LATERAL (SELECT "status" FROM "MarketplacePayment" WHERE "orderId"=o."id" ORDER BY "createdAt" DESC LIMIT 1) p ON TRUE LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id" ORDER BY o."createdAt" DESC LIMIT 100`);
    return reply.send({ orders: rows });
  });

  app.get("/admin/support/tickets", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","SUPPORT"]); if (!admin) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "SupportTicket" WHERE "status" NOT IN ('CLOSED') ORDER BY CASE "priority" WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, "lastMessageAt" ASC LIMIT 100`);
    return reply.send({ tickets: rows });
  });

  app.post("/admin/support/tickets/:id/reply", async (request, reply) => {
    const admin = await requireAdmin(request, reply, ["SUPER_ADMIN","ADMIN","SUPPORT"]); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ body: z.string().trim().min(2).max(5000), internalNote: z.boolean().default(false), status: z.enum(["OPEN","PENDING_CUSTOMER","PENDING_INTERNAL","RESOLVED","CLOSED"]).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(`INSERT INTO "SupportTicketMessage" ("id","ticketId","authorUserId","authorType","body","internalNote") VALUES ($1,$2,$3,'AGENT',$4,$5)`, randomUUID(), params.data.id, admin.id, body.data.body, body.data.internalNote);
    await prisma.$executeRawUnsafe(`UPDATE "SupportTicket" SET "assignedToUserId"=COALESCE("assignedToUserId",$1),"firstResponseAt"=COALESCE("firstResponseAt",CURRENT_TIMESTAMP),"lastMessageAt"=CURRENT_TIMESTAMP,"status"=COALESCE($2::"SupportTicketStatus","status"),"resolvedAt"=CASE WHEN $2 IN ('RESOLVED','CLOSED') THEN CURRENT_TIMESTAMP ELSE "resolvedAt" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`, admin.id, body.data.status ?? null, params.data.id);
    await audit(admin.id, "SUPPORT_REPLY", "SUPPORT_TICKET", params.data.id, { internalNote: body.data.internalNote, status: body.data.status });
    return reply.send({ replied: true });
  });

  app.get("/admin/analytics/daily", async (request, reply) => {
    const admin = await requireAdmin(request, reply); if (!admin) return;
    const days = Math.min(365, Math.max(7, Number((request.query as any)?.days ?? 30)));
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "DailyMarketplaceMetric" WHERE "date" >= CURRENT_DATE - $1::int ORDER BY "date" ASC`, days);
    return reply.send({ metrics: rows });
  });

  app.post("/internal/analytics/rollup", async (request, reply) => {
    const secret = String(request.headers["x-internal-secret"] ?? "");
    if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) return reply.code(401).send({ error: "unauthorized" });
    await prisma.$executeRawUnsafe(`INSERT INTO "DailyMarketplaceMetric" ("date","newUsers","newListings","publishedListings","orders","paidOrders","gmvMinor","platformRevenueMinor","refundsMinor","payoutsMinor","disputesOpened","supportTicketsOpened","moderationCasesOpened") SELECT CURRENT_DATE, (SELECT COUNT(*)::int FROM "User" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "Listing" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "Listing" WHERE "publishedAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "MarketplaceOrder" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "MarketplaceOrder" WHERE "paidAt"::date=CURRENT_DATE), COALESCE((SELECT SUM("totalAmountMinor") FROM "MarketplaceOrder" WHERE "paidAt"::date=CURRENT_DATE),0), COALESCE((SELECT SUM("platformCommissionMinor") FROM "MarketplaceOrder" WHERE "paidAt"::date=CURRENT_DATE),0), COALESCE((SELECT SUM("amountMinor") FROM "MarketplaceRefund" WHERE "createdAt"::date=CURRENT_DATE AND "status"='SUCCEEDED'),0), COALESCE((SELECT SUM("amountMinor") FROM "MarketplacePayout" WHERE "paidAt"::date=CURRENT_DATE),0), (SELECT COUNT(*)::int FROM "MarketplaceDispute" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "SupportTicket" WHERE "createdAt"::date=CURRENT_DATE), (SELECT COUNT(*)::int FROM "ModerationCase" WHERE "createdAt"::date=CURRENT_DATE) ON CONFLICT ("date") DO UPDATE SET "newUsers"=EXCLUDED."newUsers","newListings"=EXCLUDED."newListings","publishedListings"=EXCLUDED."publishedListings","orders"=EXCLUDED."orders","paidOrders"=EXCLUDED."paidOrders","gmvMinor"=EXCLUDED."gmvMinor","platformRevenueMinor"=EXCLUDED."platformRevenueMinor","refundsMinor"=EXCLUDED."refundsMinor","payoutsMinor"=EXCLUDED."payoutsMinor","disputesOpened"=EXCLUDED."disputesOpened","supportTicketsOpened"=EXCLUDED."supportTicketsOpened","moderationCasesOpened"=EXCLUDED."moderationCasesOpened","updatedAt"=CURRENT_TIMESTAMP`);
    return reply.send({ rolledUp: true });
  });
}
