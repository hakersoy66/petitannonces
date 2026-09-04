import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const GROWTH_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MARKETING", "FINANCE"]);

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

async function requireGrowthAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(request, reply); if (!user) return null;
  if (!user.roles.some((r: { role: string }) => GROWTH_ROLES.has(r.role))) { reply.code(403).send({ error: "forbidden" }); return null; }
  return user;
}

async function ensureWallet(userId: string) {
  await prisma.$executeRawUnsafe(`INSERT INTO "PromotionCreditWallet" ("id","userId","balance") VALUES ($1,$2,0) ON CONFLICT ("userId") DO NOTHING`, randomUUID(), userId);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; balance: number }>>(`SELECT "id","balance" FROM "PromotionCreditWallet" WHERE "userId"=$1 LIMIT 1`, userId);
  return rows[0]!;
}

function referralCode(userId: string) {
  return `PA${createHash("sha256").update(userId).digest("hex").slice(0, 8).toUpperCase()}`;
}

export async function registerGrowthRoutes(app: FastifyInstance) {
  app.get("/promotions/products", async (_request, reply) => {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","code","type","name","description","priceMinor","currency","durationHours","creditCost" FROM "PromotionProduct" WHERE "isActive"=TRUE ORDER BY "priceMinor" ASC`);
    return reply.send({ products: rows });
  });

  app.get("/promotions/wallet", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const wallet = await ensureWallet(user.id);
    const tx = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","type","amount","referenceType","referenceId","createdAt" FROM "PromotionCreditTransaction" WHERE "walletId"=$1 ORDER BY "createdAt" DESC LIMIT 50`, wallet.id);
    return reply.send({ wallet, transactions: tx });
  });

  app.post("/listings/:id/promotions", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ productCode: z.string().min(2).max(60), paymentReference: z.string().max(160).optional(), couponCode: z.string().max(60).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const products = await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "PromotionProduct" WHERE "code"=$1 AND "isActive"=TRUE LIMIT 1`, body.data.productCode);
    const product = products[0]; if (!product) return reply.code(404).send({ error: "promotion_product_not_found" });

    let coupon: any = null;
    let discountMinor = 0;
    let creditsGranted = 0;
    if (body.data.couponCode) {
      const coupons = await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "Coupon" WHERE UPPER("code")=UPPER($1) AND "isActive"=TRUE AND ("startsAt" IS NULL OR "startsAt"<=CURRENT_TIMESTAMP) AND ("endsAt" IS NULL OR "endsAt">CURRENT_TIMESTAMP) LIMIT 1`, body.data.couponCode);
      coupon = coupons[0];
      if (!coupon || (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions)) return reply.code(400).send({ error: "invalid_coupon" });
      const used = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "CouponRedemption" WHERE "couponId"=$1 AND "userId"=$2 LIMIT 1`, coupon.id, user.id);
      if (used[0]) return reply.code(409).send({ error: "coupon_already_used" });
      if (coupon.type === "PERCENT") discountMinor = Math.min(product.priceMinor, Math.round(product.priceMinor * Math.min(100, coupon.value) / 100));
      if (coupon.type === "FIXED") discountMinor = Math.min(product.priceMinor, coupon.value);
      if (coupon.type === "CREDITS") creditsGranted = coupon.value;
    }

    const wallet = await ensureWallet(user.id);
    const payableMinor = Math.max(0, product.priceMinor - discountMinor);
    const useCredits = product.creditCost > 0 && wallet.balance >= product.creditCost && !body.data.paymentReference;
    if (!useCredits && payableMinor > 0 && !body.data.paymentReference) {
      return reply.code(402).send({ error: "payment_required", amountMinor: payableMinor, currency: product.currency, creditCost: product.creditCost, walletBalance: wallet.balance });
    }

    const id = randomUUID();
    const start = new Date();
    const end = product.durationHours ? new Date(start.getTime() + Number(product.durationHours) * 3600_000) : null;
    await prisma.$executeRawUnsafe(`INSERT INTO "ListingPromotion" ("id","listingId","userId","productId","status","startsAt","endsAt","source","externalPaymentReference") VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8)`, id, listing.id, user.id, product.id, start, end, useCredits ? "CREDITS" : payableMinor === 0 ? "COUPON" : "PAYMENT", body.data.paymentReference ?? null);

    if (useCredits) {
      await prisma.$executeRawUnsafe(`UPDATE "PromotionCreditWallet" SET "balance"="balance"-$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2 AND "balance">=$1`, product.creditCost, wallet.id);
      await prisma.$executeRawUnsafe(`INSERT INTO "PromotionCreditTransaction" ("id","walletId","type","amount","referenceType","referenceId") VALUES ($1,$2,'CONSUME',$3,'LISTING_PROMOTION',$4)`, randomUUID(), wallet.id, -Number(product.creditCost), id);
    }
    if (coupon) {
      await prisma.$executeRawUnsafe(`INSERT INTO "CouponRedemption" ("id","couponId","userId","promotionId","discountMinor","creditsGranted") VALUES ($1,$2,$3,$4,$5,$6)`, randomUUID(), coupon.id, user.id, id, discountMinor, creditsGranted);
      await prisma.$executeRawUnsafe(`UPDATE "Coupon" SET "redemptions"="redemptions"+1 WHERE "id"=$1`, coupon.id);
      if (creditsGranted > 0) {
        await prisma.$executeRawUnsafe(`UPDATE "PromotionCreditWallet" SET "balance"="balance"+$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, creditsGranted, wallet.id);
        await prisma.$executeRawUnsafe(`INSERT INTO "PromotionCreditTransaction" ("id","walletId","type","amount","referenceType","referenceId") VALUES ($1,$2,'GRANT',$3,'COUPON',$4)`, randomUUID(), wallet.id, creditsGranted, coupon.id);
      }
    }
    await prisma.$executeRawUnsafe(`INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","properties") VALUES ($1,$2,'PROMOTION_ACTIVATED','WEB',$3::jsonb)`, randomUUID(), user.id, JSON.stringify({ listingId: listing.id, productCode: product.code, source: useCredits ? "credits" : payableMinor === 0 ? "coupon" : "payment", payableMinor }));
    return reply.code(201).send({ promotion: { id, productCode: product.code, status: "ACTIVE", startsAt: start, endsAt: end }, charged: { amountMinor: payableMinor, credits: useCredits ? product.creditCost : 0 } });
  });

  app.get("/listings/:id/promotions", async (request, reply) => {
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT lp."id",pp."code",pp."type",pp."name",lp."status",lp."startsAt",lp."endsAt" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."listingId"=$1 AND lp."status"='ACTIVE' AND (lp."endsAt" IS NULL OR lp."endsAt">CURRENT_TIMESTAMP) ORDER BY lp."createdAt" DESC`, parsed.data.id);
    return reply.send({ promotions: rows });
  });

  app.get("/referrals/me", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const code = referralCode(user.id);
    await prisma.$executeRawUnsafe(`INSERT INTO "ReferralCode" ("id","ownerUserId","code","rewardCredits") VALUES ($1,$2,$3,1) ON CONFLICT ("ownerUserId") DO NOTHING`, randomUUID(), user.id, code);
    const rows = await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ReferralCode" WHERE "ownerUserId"=$1 LIMIT 1`, user.id);
    const referrals = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT r."id",r."status",r."createdAt",r."qualifiedAt",r."rewardedAt" FROM "Referral" r WHERE r."referralCodeId"=$1 ORDER BY r."createdAt" DESC`, rows[0].id);
    return reply.send({ referralCode: rows[0], referrals });
  });

  app.post("/referrals/apply", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ code: z.string().min(4).max(40) }).safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const codes = await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ReferralCode" WHERE UPPER("code")=UPPER($1) LIMIT 1`, parsed.data.code);
    const code = codes[0]; if (!code || code.ownerUserId === user.id) return reply.code(400).send({ error: "invalid_referral" });
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "Referral" ("id","referralCodeId","referredUserId","status") VALUES ($1,$2,$3,'PENDING')`, randomUUID(), code.id, user.id);
    } catch { return reply.code(409).send({ error: "referral_already_applied" }); }
    return reply.code(201).send({ applied: true });
  });

  app.post("/growth/events", async (request, reply) => {
    const user = await currentUser(request);
    const parsed = z.object({ eventName: z.string().min(2).max(100), channel: z.string().max(40).optional(), campaign: z.string().max(120).optional(), source: z.string().max(120).optional(), medium: z.string().max(120).optional(), properties: z.record(z.string(), z.unknown()).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const d = parsed.data;
    await prisma.$executeRawUnsafe(`INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","campaign","source","medium","properties") VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, randomUUID(), user?.id ?? null, d.eventName, d.channel ?? null, d.campaign ?? null, d.source ?? null, d.medium ?? null, JSON.stringify(d.properties ?? {}));
    return reply.code(202).send({ accepted: true });
  });

  app.get("/admin/growth/summary", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const [promotions, revenue, events, referrals] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ active: bigint; total: bigint }>>(`SELECT COUNT(*) FILTER (WHERE "status"='ACTIVE' AND ("endsAt" IS NULL OR "endsAt">CURRENT_TIMESTAMP))::bigint AS active, COUNT(*)::bigint AS total FROM "ListingPromotion"`),
      prisma.$queryRawUnsafe<Array<{ revenue: bigint }>>(`SELECT COALESCE(SUM(pp."priceMinor"),0)::bigint AS revenue FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."source"='PAYMENT'`),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "eventName",COUNT(*)::bigint AS count FROM "GrowthEvent" WHERE "occurredAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' GROUP BY "eventName" ORDER BY count DESC LIMIT 20`),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "status",COUNT(*)::bigint AS count FROM "Referral" GROUP BY "status"`),
    ]);
    return reply.send({ promotions: { active: Number(promotions[0]?.active ?? 0), total: Number(promotions[0]?.total ?? 0) }, promotionRevenueMinor: Number(revenue[0]?.revenue ?? 0), events, referrals });
  });

  app.post("/admin/growth/credits/grant", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const parsed = z.object({ userId: z.string().min(1), amount: z.number().int().positive().max(10000), reason: z.string().min(3).max(300) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const wallet = await ensureWallet(parsed.data.userId);
    await prisma.$executeRawUnsafe(`UPDATE "PromotionCreditWallet" SET "balance"="balance"+$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, parsed.data.amount, wallet.id);
    await prisma.$executeRawUnsafe(`INSERT INTO "PromotionCreditTransaction" ("id","walletId","type","amount","referenceType","metadata") VALUES ($1,$2,'GRANT',$3,'ADMIN',$4::jsonb)`, randomUUID(), wallet.id, parsed.data.amount, JSON.stringify({ reason: parsed.data.reason, actorUserId: admin.id }));
    return reply.send({ granted: true, amount: parsed.data.amount });
  });
}
