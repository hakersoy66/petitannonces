import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const DEFAULT_PROTECTION_HOURS = 48;

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

async function getOrder(orderId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(`SELECT * FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`, orderId);
  return rows[0] ?? null;
}

function verifyCarrierWebhook(raw: string, signature: string) {
  const secret = process.env.SHIPPING_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function openProtectionWindow(orderId: string, deliveredAt: Date) {
  const hours = Math.max(1, Number(process.env.BUYER_PROTECTION_HOURS ?? DEFAULT_PROTECTION_HOURS));
  const endsAt = new Date(deliveredAt.getTime() + hours * 60 * 60 * 1000);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BuyerProtectionWindow" ("id","orderId","startsAt","endsAt","payoutEligibleAt") VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT ("orderId") DO UPDATE SET "startsAt"=EXCLUDED."startsAt","endsAt"=EXCLUDED."endsAt","payoutEligibleAt"=EXCLUDED."payoutEligibleAt","updatedAt"=CURRENT_TIMESTAMP`,
    randomUUID(), orderId, deliveredAt, endsAt,
  );
  return endsAt;
}

export async function registerShippingRoutes(app: FastifyInstance) {
  app.post("/orders/:id/shipment", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ carrier: z.string().trim().min(2).max(60), service: z.string().trim().max(80).optional(), trackingNumber: z.string().trim().min(3).max(120), trackingUrl: z.string().url().optional(), labelUrl: z.string().url().optional(), estimatedDeliveryAt: z.coerce.date().optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const order = await getOrder(params.data.id);
    if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.sellerId !== user.id) return reply.code(403).send({ error: "seller_only" });
    if (!["PAID","PROCESSING"].includes(String(order.status))) return reply.code(409).send({ error: "order_not_ready_to_ship" });
    const shipmentId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MarketplaceShipment" ("id","orderId","carrier","service","trackingNumber","trackingUrl","labelUrl","status","shippedAt","estimatedDeliveryAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,'IN_TRANSIT',CURRENT_TIMESTAMP,$8)
       ON CONFLICT ("orderId") DO UPDATE SET "carrier"=EXCLUDED."carrier","service"=EXCLUDED."service","trackingNumber"=EXCLUDED."trackingNumber","trackingUrl"=EXCLUDED."trackingUrl","labelUrl"=EXCLUDED."labelUrl","status"='IN_TRANSIT',"shippedAt"=COALESCE("MarketplaceShipment"."shippedAt",CURRENT_TIMESTAMP),"estimatedDeliveryAt"=EXCLUDED."estimatedDeliveryAt","updatedAt"=CURRENT_TIMESTAMP`,
      shipmentId, order.id, body.data.carrier, body.data.service ?? null, body.data.trackingNumber, body.data.trackingUrl ?? null, body.data.labelUrl ?? null, body.data.estimatedDeliveryAt ?? null,
    );
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='SHIPPED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, order.id);
    return reply.code(201).send({ shipment: { orderId: order.id, carrier: body.data.carrier, trackingNumber: body.data.trackingNumber, status: "IN_TRANSIT" } });
  });

  app.get("/orders/:id/shipment", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_order" });
    const order = await getOrder(parsed.data.id); if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.buyerId !== user.id && order.sellerId !== user.id) return reply.code(403).send({ error: "forbidden" });
    const shipment = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "MarketplaceShipment" WHERE "orderId"=$1 LIMIT 1`, order.id);
    const protection = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "BuyerProtectionWindow" WHERE "orderId"=$1 LIMIT 1`, order.id);
    return reply.send({ shipment: shipment[0] ?? null, buyerProtection: protection[0] ?? null });
  });

  app.post("/shipping/webhooks/:carrier", async (request, reply) => {
    const params = z.object({ carrier: z.string().min(1).max(60) }).safeParse(request.params);
    const body = z.object({ trackingNumber: z.string().min(3).max(120), status: z.enum(["LABEL_CREATED","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED","EXCEPTION","RETURNED","LOST","CANCELED"]), eventAt: z.coerce.date().optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const raw = JSON.stringify(request.body ?? {});
    const signature = String(request.headers["x-shipping-signature"] ?? "");
    if (!verifyCarrierWebhook(raw, signature)) return reply.code(401).send({ error: "invalid_signature" });
    const eventAt = body.data.eventAt ?? new Date();
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(`SELECT * FROM "MarketplaceShipment" WHERE "carrier"=$1 AND "trackingNumber"=$2 LIMIT 1`, params.data.carrier, body.data.trackingNumber);
    const shipment = rows[0]; if (!shipment) return reply.code(404).send({ error: "shipment_not_found" });
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceShipment" SET "status"=$1::"ShipmentStatus","lastCarrierEventAt"=$2,"deliveredAt"=CASE WHEN $1='DELIVERED' THEN COALESCE("deliveredAt",$2) ELSE "deliveredAt" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`, body.data.status, eventAt, shipment.id);
    if (body.data.status === "DELIVERED") {
      await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='DELIVERED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, shipment.orderId);
      await openProtectionWindow(String(shipment.orderId), eventAt);
    }
    return reply.send({ received: true });
  });

  app.post("/orders/:id/confirm-delivery", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_order" });
    const order = await getOrder(parsed.data.id); if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.buyerId !== user.id) return reply.code(403).send({ error: "buyer_only" });
    if (String(order.status) !== "DELIVERED") return reply.code(409).send({ error: "order_not_delivered" });
    const active = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id" FROM "MarketplaceDispute" WHERE "orderId"=$1 AND "status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED') LIMIT 1`, order.id);
    if (active[0]) return reply.code(409).send({ error: "active_dispute" });
    await prisma.$executeRawUnsafe(`UPDATE "BuyerProtectionWindow" SET "confirmationStatus"='BUYER_CONFIRMED',"confirmedAt"=CURRENT_TIMESTAMP,"payoutEligibleAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, order.id);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='COMPLETED',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, order.id);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "availableAt"=CURRENT_TIMESTAMP,"status"=CASE WHEN "status"='BLOCKED' THEN 'PENDING'::"PayoutStatus" ELSE "status" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, order.id);
    return reply.send({ confirmed: true, orderStatus: "COMPLETED" });
  });

  app.post("/internal/buyer-protection/sweep", async (request, reply) => {
    const secret = String(request.headers["x-internal-secret"] ?? "");
    if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) return reply.code(401).send({ error: "unauthorized" });
    const expired = await prisma.$queryRawUnsafe<Array<{ orderId: string }>>(
      `SELECT bp."orderId" FROM "BuyerProtectionWindow" bp
       JOIN "MarketplaceOrder" o ON o."id"=bp."orderId"
       WHERE bp."confirmationStatus"='WAITING' AND bp."endsAt" <= CURRENT_TIMESTAMP AND o."status"='DELIVERED'
       AND NOT EXISTS (SELECT 1 FROM "MarketplaceDispute" d WHERE d."orderId"=bp."orderId" AND d."status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED'))
       LIMIT 200`,
    );
    for (const item of expired) {
      await prisma.$executeRawUnsafe(`UPDATE "BuyerProtectionWindow" SET "confirmationStatus"='AUTO_CONFIRMED',"confirmedAt"=CURRENT_TIMESTAMP,"payoutEligibleAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, item.orderId);
      await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='COMPLETED',"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, item.orderId);
      await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "availableAt"=CURRENT_TIMESTAMP,"status"=CASE WHEN "status"='BLOCKED' THEN 'PENDING'::"PayoutStatus" ELSE "status" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, item.orderId);
    }
    return reply.send({ processed: expired.length });
  });
}
