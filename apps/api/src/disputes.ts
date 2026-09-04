import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { roles: true } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthorized" }); return null;
  }
  return session.user;
}

async function getOrder(orderId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(`SELECT * FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`, orderId);
  return rows[0] ?? null;
}

async function getDispute(disputeId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(`SELECT * FROM "MarketplaceDispute" WHERE "id"=$1 LIMIT 1`, disputeId);
  return rows[0] ?? null;
}

function isDisputeStaff(user: { roles: Array<{ role: string }> }) {
  return user.roles.some((item) => ["SUPER_ADMIN","ADMIN","SUPPORT","FINANCE","COMPLIANCE","MODERATOR"].includes(item.role));
}

export async function registerDisputeRoutes(app: FastifyInstance) {
  app.post("/orders/:id/disputes", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ reason: z.enum(["ITEM_NOT_RECEIVED","ITEM_NOT_AS_DESCRIBED","DAMAGED_ITEM","COUNTERFEIT_SUSPECTED","MISSING_PARTS","WRONG_ITEM","OTHER"]), summary: z.string().trim().min(10).max(2000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const order = await getOrder(params.data.id); if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.buyerId !== user.id && order.sellerId !== user.id) return reply.code(403).send({ error: "forbidden" });
    if (!["PAID","PROCESSING","SHIPPED","DELIVERED"].includes(String(order.status))) return reply.code(409).send({ error: "order_not_disputable" });
    const id = randomUUID();
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceDispute" ("id","orderId","openedById","reason","summary") VALUES ($1,$2,$3,$4::"DisputeReason",$5)`, id, order.id, user.id, body.data.reason, body.data.summary);
    } catch (error) {
      if (String(error).includes("MarketplaceDispute_active_order_idx")) return reply.code(409).send({ error: "active_dispute_exists" });
      throw error;
    }
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='DISPUTED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, order.id);
    await prisma.$executeRawUnsafe(`UPDATE "BuyerProtectionWindow" SET "confirmationStatus"='DISPUTED',"payoutEligibleAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, order.id);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','PROCESSING')`, order.id);
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'SYSTEM',$4)`, randomUUID(), id, user.id, `Litige ouvert : ${body.data.reason}`);
    return reply.code(201).send({ dispute: { id, orderId: order.id, status: "OPEN", reason: body.data.reason } });
  });

  app.get("/disputes/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_dispute" });
    const dispute = await getDispute(parsed.data.id); if (!dispute) return reply.code(404).send({ error: "dispute_not_found" });
    const order = await getOrder(String(dispute.orderId));
    if (!order || (order.buyerId !== user.id && order.sellerId !== user.id && !isDisputeStaff(user))) return reply.code(403).send({ error: "forbidden" });
    const messages = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "DisputeMessage" WHERE "disputeId"=$1 ORDER BY "createdAt" ASC`, dispute.id);
    const evidence = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "DisputeEvidence" WHERE "disputeId"=$1 ORDER BY "createdAt" ASC`, dispute.id);
    return reply.send({ dispute, messages, evidence });
  });

  app.post("/disputes/:id/messages", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const dispute = await getDispute(params.data.id); if (!dispute) return reply.code(404).send({ error: "dispute_not_found" });
    const order = await getOrder(String(dispute.orderId));
    if (!order || (order.buyerId !== user.id && order.sellerId !== user.id && !isDisputeStaff(user))) return reply.code(403).send({ error: "forbidden" });
    if (["CLOSED","RESOLVED_BUYER","RESOLVED_SELLER"].includes(String(dispute.status))) return reply.code(409).send({ error: "dispute_closed" });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'TEXT',$4)`, id, dispute.id, user.id, body.data.body);
    return reply.code(201).send({ message: { id, body: body.data.body } });
  });

  app.post("/disputes/:id/evidence", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ fileUrl: z.string().url(), fileName: z.string().max(255).optional(), mimeType: z.string().max(120).optional(), sizeBytes: z.number().int().nonnegative().max(20_000_000).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const dispute = await getDispute(params.data.id); if (!dispute) return reply.code(404).send({ error: "dispute_not_found" });
    const order = await getOrder(String(dispute.orderId));
    if (!order || (order.buyerId !== user.id && order.sellerId !== user.id)) return reply.code(403).send({ error: "forbidden" });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeEvidence" ("id","disputeId","uploadedById","fileUrl","fileName","mimeType","sizeBytes") VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, dispute.id, user.id, body.data.fileUrl, body.data.fileName ?? null, body.data.mimeType ?? null, body.data.sizeBytes ?? null);
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'EVIDENCE',$4)`, randomUUID(), dispute.id, user.id, body.data.fileName ?? "Pièce justificative ajoutée");
    return reply.code(201).send({ evidence: { id, fileUrl: body.data.fileUrl } });
  });

  app.post("/admin/disputes/:id/status", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!isDisputeStaff(user)) return reply.code(403).send({ error: "admin_required" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ status: z.enum(["UNDER_REVIEW","AWAITING_BUYER","AWAITING_SELLER"]) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceDispute" SET "status"=$1::"DisputeStatus","updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, body.data.status, params.data.id);
    return reply.send({ updated: true });
  });

  app.post("/admin/disputes/:id/resolve", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!isDisputeStaff(user)) return reply.code(403).send({ error: "admin_required" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ outcome: z.enum(["BUYER","SELLER"]), resolution: z.string().trim().min(5).max(2000), refundAmountMinor: z.number().int().nonnegative().optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const dispute = await getDispute(params.data.id); if (!dispute) return reply.code(404).send({ error: "dispute_not_found" });
    const order = await getOrder(String(dispute.orderId)); if (!order) return reply.code(404).send({ error: "order_not_found" });
    const status = body.data.outcome === "BUYER" ? "RESOLVED_BUYER" : "RESOLVED_SELLER";
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceDispute" SET "status"=$1::"DisputeStatus","resolution"=$2,"refundAmountMinor"=$3,"resolvedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4`, status, body.data.resolution, body.data.refundAmountMinor ?? null, dispute.id);
    if (body.data.outcome === "SELLER") {
      await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='COMPLETED',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, order.id);
      await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"=CASE WHEN "status"='BLOCKED' THEN 'PENDING'::"PayoutStatus" ELSE "status" END,"availableAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, order.id);
    } else {
      await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='REFUNDED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, order.id);
      await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" <> 'PAID'`, order.id);
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'SYSTEM',$4)`, randomUUID(), dispute.id, user.id, `Décision : ${body.data.resolution}`);
    return reply.send({ resolved: true, status });
  });
}
