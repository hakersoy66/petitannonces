import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MARKETING", "FINANCE"]);

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function requireGrowthAdmin(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { roles: true } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") { reply.code(401).send({ error: "unauthorized" }); return null; }
  if (!session.user.roles.some((r: { role: string }) => ROLES.has(r.role))) { reply.code(403).send({ error: "forbidden" }); return null; }
  return session.user;
}

async function ensureWallet(userId: string) {
  await prisma.$executeRawUnsafe(`INSERT INTO "PromotionCreditWallet" ("id","userId","balance") VALUES ($1,$2,0) ON CONFLICT ("userId") DO NOTHING`, randomUUID(), userId);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; balance: number }>>(`SELECT "id","balance" FROM "PromotionCreditWallet" WHERE "userId"=$1 LIMIT 1`, userId);
  return rows[0]!;
}

export async function registerGrowthAdminRoutes(app: FastifyInstance) {
  app.get("/admin/growth/coupons", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","code","type","value","currency","maxRedemptions","redemptions","startsAt","endsAt","isActive","createdAt" FROM "Coupon" ORDER BY "createdAt" DESC LIMIT 100`);
    return reply.send({ coupons: rows });
  });

  app.post("/admin/growth/coupons", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const parsed = z.object({
      code: z.string().trim().min(3).max(40).transform((v) => v.toUpperCase()),
      type: z.enum(["PERCENT","FIXED","CREDITS"]),
      value: z.number().int().positive().max(100000),
      currency: z.string().length(3).default("EUR"),
      maxRedemptions: z.number().int().positive().max(1_000_000).optional(),
      startsAt: z.coerce.date().optional(),
      endsAt: z.coerce.date().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    if (parsed.data.type === "PERCENT" && parsed.data.value > 100) return reply.code(400).send({ error: "percent_above_100" });
    if (parsed.data.startsAt && parsed.data.endsAt && parsed.data.endsAt <= parsed.data.startsAt) return reply.code(400).send({ error: "invalid_period" });
    try {
      const id = randomUUID();
      await prisma.$executeRawUnsafe(`INSERT INTO "Coupon" ("id","code","type","value","currency","maxRedemptions","startsAt","endsAt") VALUES ($1,$2,$3::"CouponType",$4,$5,$6,$7,$8)`, id, parsed.data.code, parsed.data.type, parsed.data.value, parsed.data.currency.toUpperCase(), parsed.data.maxRedemptions ?? null, parsed.data.startsAt ?? null, parsed.data.endsAt ?? null);
      await prisma.$executeRawUnsafe(`INSERT INTO "GrowthEvent" ("id","userId","eventName","channel","campaign","properties") VALUES ($1,$2,'COUPON_CREATED','ADMIN',$3,$4::jsonb)`, randomUUID(), admin.id, parsed.data.code, JSON.stringify({ type: parsed.data.type, value: parsed.data.value }));
      return reply.code(201).send({ coupon: { id, ...parsed.data, isActive: true } });
    } catch { return reply.code(409).send({ error: "coupon_code_exists" }); }
  });

  app.patch("/admin/growth/coupons/:id", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ isActive: z.boolean() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(`UPDATE "Coupon" SET "isActive"=$1 WHERE "id"=$2`, body.data.isActive, params.data.id);
    return reply.send({ updated: true });
  });

  app.post("/admin/growth/referrals/:id/qualify", async (request, reply) => {
    const admin = await requireGrowthAdmin(request, reply); if (!admin) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_referral" });
    const rows = await prisma.$queryRawUnsafe<Array<any>>(`SELECT r.*,rc."ownerUserId",rc."rewardCredits" FROM "Referral" r JOIN "ReferralCode" rc ON rc."id"=r."referralCodeId" WHERE r."id"=$1 LIMIT 1`, parsed.data.id);
    const referral = rows[0]; if (!referral) return reply.code(404).send({ error: "referral_not_found" });
    if (referral.status === "REWARDED") return reply.send({ rewarded: true, duplicate: true });
    const wallet = await ensureWallet(referral.ownerUserId);
    const reward = Number(referral.rewardCredits ?? 1);
    await prisma.$executeRawUnsafe(`UPDATE "Referral" SET "status"='REWARDED',"qualifiedAt"=COALESCE("qualifiedAt",CURRENT_TIMESTAMP),"rewardedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, referral.id);
    await prisma.$executeRawUnsafe(`UPDATE "PromotionCreditWallet" SET "balance"="balance"+$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, reward, wallet.id);
    await prisma.$executeRawUnsafe(`INSERT INTO "PromotionCreditTransaction" ("id","walletId","type","amount","referenceType","referenceId","metadata") VALUES ($1,$2,'GRANT',$3,'REFERRAL',$4,$5::jsonb)`, randomUUID(), wallet.id, reward, referral.id, JSON.stringify({ actorUserId: admin.id }));
    return reply.send({ rewarded: true, credits: reward });
  });

  app.post("/internal/growth/grant-professional-credits", async (request, reply) => {
    const secret = String(request.headers["x-internal-secret"] ?? "");
    if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) return reply.code(401).send({ error: "unauthorized" });
    const subs = await prisma.$queryRawUnsafe<Array<any>>(`SELECT ps."id" AS "subscriptionId",ps."userId",p."featuredCreditsMonthly" FROM "ProfessionalSubscription" ps JOIN "ProfessionalPlan" p ON p."id"=ps."planId" WHERE ps."status" IN ('TRIALING','ACTIVE') AND p."featuredCreditsMonthly">0 AND (ps."currentPeriodEnd" IS NULL OR ps."currentPeriodEnd">CURRENT_TIMESTAMP)`);
    let grantedUsers = 0;
    let credits = 0;
    const monthRef = new Date().toISOString().slice(0, 7);
    for (const sub of subs) {
      const wallet = await ensureWallet(sub.userId);
      const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "PromotionCreditTransaction" WHERE "walletId"=$1 AND "type"='GRANT' AND "referenceType"='PRO_PLAN_MONTHLY' AND "referenceId"=$2 LIMIT 1`, wallet.id, `${sub.subscriptionId}:${monthRef}`);
      if (existing[0]) continue;
      const amount = Number(sub.featuredCreditsMonthly);
      await prisma.$executeRawUnsafe(`UPDATE "PromotionCreditWallet" SET "balance"="balance"+$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, amount, wallet.id);
      await prisma.$executeRawUnsafe(`INSERT INTO "PromotionCreditTransaction" ("id","walletId","type","amount","referenceType","referenceId") VALUES ($1,$2,'GRANT',$3,'PRO_PLAN_MONTHLY',$4)`, randomUUID(), wallet.id, amount, `${sub.subscriptionId}:${monthRef}`);
      grantedUsers += 1; credits += amount;
    }
    return reply.send({ grantedUsers, credits, period: monthRef });
  });
}
