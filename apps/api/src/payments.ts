import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const BUYER_FEE_RATE = 0.04;
const BUYER_FEE_MIN_MINOR = 99;
const COMMISSION_RATE = 0.08;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return session.user;
}

function quote(itemAmountMinor: number, shippingAmountMinor: number) {
  const buyerProtectionFeeMinor = Math.max(BUYER_FEE_MIN_MINOR, Math.round(itemAmountMinor * BUYER_FEE_RATE));
  const platformCommissionMinor = Math.round(itemAmountMinor * COMMISSION_RATE);
  const sellerNetMinor = Math.max(0, itemAmountMinor - platformCommissionMinor);
  const totalAmountMinor = itemAmountMinor + shippingAmountMinor + buyerProtectionFeeMinor;
  return { itemAmountMinor, shippingAmountMinor, buyerProtectionFeeMinor, platformCommissionMinor, sellerNetMinor, totalAmountMinor };
}

function paymentProvider() {
  return process.env.MARKETPLACE_PAYMENT_PROVIDER ?? "mock";
}

async function providerRequest(path: string, input: Record<string, unknown>, idempotencyKey: string) {
  const provider = paymentProvider();
  if (provider === "mock") return { provider, id: `mock_${randomUUID()}`, url: `/checkout/mock/${String(input.orderId ?? "")}` };
  const baseUrl = process.env.MARKETPLACE_PAYMENT_API_URL;
  const token = process.env.MARKETPLACE_PAYMENT_API_TOKEN;
  if (!baseUrl || !token) throw new Error("payment_provider_not_configured");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": idempotencyKey },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`payment_provider_error_${response.status}`);
  return { provider, ...((await response.json()) as Record<string, unknown>) };
}

function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = process.env.MARKETPLACE_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

type OrderRow = {
  id: string;
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  currency: string;
  totalAmountMinor: number;
  sellerNetMinor: number;
  status: string;
  paymentProvider: string | null;
};

type PaymentRow = { id: string; provider: string; amountMinor: number; currency: string; status: string };

export async function registerPaymentRoutes(app: FastifyInstance) {
  app.post("/checkout/quote", async (request, reply) => {
    const parsed = z.object({ itemAmountMinor: z.number().int().positive(), shippingAmountMinor: z.number().int().nonnegative().default(0) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    return reply.send({ quote: quote(parsed.data.itemAmountMinor, parsed.data.shippingAmountMinor) });
  });

  app.post("/checkout/orders", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = z.object({ listingId: z.string().min(1), offerId: z.string().min(1).optional(), shippingAmountMinor: z.number().int().nonnegative().default(0), idempotencyKey: z.string().min(12).max(120) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, status: "PUBLISHED" } });
    if (!listing || listing.priceMinor == null) return reply.code(404).send({ error: "listing_not_available" });
    if (listing.sellerId === user.id) return reply.code(400).send({ error: "cannot_buy_own_listing" });

    let itemAmountMinor = listing.priceMinor;
    if (parsed.data.offerId) {
      const offer = await prisma.offer.findFirst({ where: { id: parsed.data.offerId, listingId: listing.id, status: "ACCEPTED", makerId: user.id } });
      if (!offer) return reply.code(400).send({ error: "accepted_offer_not_found" });
      itemAmountMinor = offer.amountMinor;
    }
    const totals = quote(itemAmountMinor, parsed.data.shippingAmountMinor);
    const orderId = randomUUID();
    const orderNumber = `PA-${Date.now().toString(36).toUpperCase()}-${orderId.slice(0, 6).toUpperCase()}`;

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "MarketplaceOrder" ("id","orderNumber","listingId","offerId","buyerId","sellerId","currency","itemAmountMinor","shippingAmountMinor","buyerProtectionFeeMinor","platformCommissionMinor","sellerNetMinor","totalAmountMinor","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING_PAYMENT',$14)`,
        orderId, orderNumber, listing.id, parsed.data.offerId ?? null, user.id, listing.sellerId, listing.currency, totals.itemAmountMinor, totals.shippingAmountMinor, totals.buyerProtectionFeeMinor, totals.platformCommissionMinor, totals.sellerNetMinor, totals.totalAmountMinor, parsed.data.idempotencyKey,
      );
      const checkoutResult = await providerRequest("/checkouts", { orderId, amountMinor: totals.totalAmountMinor, currency: listing.currency }, parsed.data.idempotencyKey);
      const checkoutId = String(checkoutResult.id ?? `mock_${orderId}`);
      const checkoutUrl = String(checkoutResult.url ?? `/checkout/mock/${orderId}`);
      await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "paymentProvider"=$1,"providerCheckoutId"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`, checkoutResult.provider, checkoutId, orderId);
      const paymentId = randomUUID();
      await prisma.$executeRawUnsafe(`INSERT INTO "MarketplacePayment" ("id","orderId","provider","amountMinor","currency","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,'CREATED',$6)`, paymentId, orderId, checkoutResult.provider, totals.totalAmountMinor, listing.currency, `${parsed.data.idempotencyKey}:payment`);
      for (const [type, amount] of [["ORDER_GROSS", totals.itemAmountMinor],["BUYER_FEE", totals.buyerProtectionFeeMinor],["PLATFORM_COMMISSION", totals.platformCommissionMinor],["SELLER_NET", totals.sellerNetMinor]] as const) {
        await prisma.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency") VALUES ($1,$2,$3::"LedgerEntryType",$4,$5)`, randomUUID(), orderId, type, amount, listing.currency);
      }
      return reply.code(201).send({ order: { id: orderId, orderNumber, ...totals, currency: listing.currency, status: "PENDING_PAYMENT" }, checkout: { provider: checkoutResult.provider, checkoutId, checkoutUrl } });
    } catch (error) {
      if (String(error).toLowerCase().includes("unique") || String(error).includes("idempotencyKey")) return reply.code(409).send({ error: "duplicate_checkout" });
      throw error;
    }
  });

  app.get("/orders/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_order" });
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "MarketplaceOrder" WHERE "id"=$1 AND ("buyerId"=$2 OR "sellerId"=$2) LIMIT 1`, parsed.data.id, user.id);
    if (!rows[0]) return reply.code(404).send({ error: "order_not_found" });
    return reply.send({ order: rows[0] });
  });

  app.post("/orders/:id/refunds", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ amountMinor: z.number().int().positive().optional(), reason: z.string().trim().max(500).optional(), idempotencyKey: z.string().min(12).max(120) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const orders = await prisma.$queryRawUnsafe<OrderRow[]>(`SELECT "id","orderNumber","buyerId","sellerId","currency","totalAmountMinor","sellerNetMinor","status","paymentProvider" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`, params.data.id);
    const order = orders[0];
    if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.buyerId !== user.id && order.sellerId !== user.id) return reply.code(403).send({ error: "forbidden" });
    if (!["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED","DISPUTED"].includes(order.status)) return reply.code(409).send({ error: "order_not_refundable" });
    const payments = await prisma.$queryRawUnsafe<PaymentRow[]>(`SELECT "id","provider","amountMinor","currency","status" FROM "MarketplacePayment" WHERE "orderId"=$1 AND "status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED') ORDER BY "createdAt" DESC LIMIT 1`, order.id);
    const payment = payments[0];
    if (!payment) return reply.code(409).send({ error: "captured_payment_not_found" });
    const amountMinor = body.data.amountMinor ?? payment.amountMinor;
    if (amountMinor > payment.amountMinor) return reply.code(400).send({ error: "refund_exceeds_payment" });
    const providerRefund = await providerRequest("/refunds", { orderId: order.id, paymentId: payment.id, amountMinor, currency: order.currency, reason: body.data.reason }, body.data.idempotencyKey);
    const refundId = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceRefund" ("id","orderId","paymentId","providerRefundId","amountMinor","currency","reason","status","idempotencyKey") VALUES ($1,$2,$3,$4,$5,$6,$7,'PROCESSING',$8)`, refundId, order.id, payment.id, String(providerRefund.id ?? `mock_${refundId}`), amountMinor, order.currency, body.data.reason ?? null, body.data.idempotencyKey);
    await prisma.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") VALUES ($1,$2,'REFUND',$3,$4,$5)`, randomUUID(), order.id, -amountMinor, order.currency, refundId);
    return reply.code(202).send({ refund: { id: refundId, amountMinor, currency: order.currency, status: "PROCESSING" } });
  });

  app.post("/orders/:id/payout", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ idempotencyKey: z.string().min(12).max(120) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const orders = await prisma.$queryRawUnsafe<OrderRow[]>(`SELECT "id","orderNumber","buyerId","sellerId","currency","totalAmountMinor","sellerNetMinor","status","paymentProvider" FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`, params.data.id);
    const order = orders[0];
    if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.sellerId !== user.id) return reply.code(403).send({ error: "seller_only" });
    if (!["DELIVERED","COMPLETED"].includes(order.status)) return reply.code(409).send({ error: "payout_not_available" });
    const providerPayout = await providerRequest("/payouts", { orderId: order.id, sellerId: order.sellerId, amountMinor: order.sellerNetMinor, currency: order.currency }, body.data.idempotencyKey);
    const payoutId = randomUUID();
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "MarketplacePayout" ("id","orderId","sellerId","providerPayoutId","amountMinor","currency","status","idempotencyKey","availableAt") VALUES ($1,$2,$3,$4,$5,$6,'PROCESSING',$7,CURRENT_TIMESTAMP)`, payoutId, order.id, order.sellerId, String(providerPayout.id ?? `mock_${payoutId}`), order.sellerNetMinor, order.currency, body.data.idempotencyKey);
      await prisma.$executeRawUnsafe(`INSERT INTO "FinancialLedgerEntry" ("id","orderId","type","amountMinor","currency","reference") VALUES ($1,$2,'PAYOUT',$3,$4,$5)`, randomUUID(), order.id, -order.sellerNetMinor, order.currency, payoutId);
    } catch {
      return reply.code(409).send({ error: "payout_already_exists" });
    }
    return reply.code(202).send({ payout: { id: payoutId, amountMinor: order.sellerNetMinor, currency: order.currency, status: "PROCESSING" } });
  });

  app.post("/payments/webhooks/:provider", async (request, reply) => {
    const parsed = z.object({ provider: z.string().min(1).max(40) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_provider" });
    const eventId = String(request.headers["x-provider-event-id"] ?? "");
    const signature = String(request.headers["x-provider-signature"] ?? "");
    if (!eventId) return reply.code(400).send({ error: "missing_event_id" });
    const raw = JSON.stringify(request.body ?? {});
    if (!verifyWebhookSignature(raw, signature)) return reply.code(401).send({ error: "invalid_webhook_signature" });
    const payloadHash = sha256(raw);
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "PaymentWebhookEvent" ("id","provider","providerEventId","eventType","payloadHash") VALUES ($1,$2,$3,$4,$5)`, randomUUID(), parsed.data.provider, eventId, String((request.body as { type?: string })?.type ?? "unknown"), payloadHash);
    } catch {
      return reply.send({ received: true, duplicate: true });
    }
    await prisma.$executeRawUnsafe(`UPDATE "PaymentWebhookEvent" SET "processedAt"=CURRENT_TIMESTAMP WHERE "provider"=$1 AND "providerEventId"=$2`, parsed.data.provider, eventId);
    return reply.send({ received: true });
  });
}
