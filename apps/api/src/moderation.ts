import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const MODERATION_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "COMPLIANCE"]);

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function currentUser(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { roles: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  return session.user;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) { reply.code(401).send({ error: "unauthorized" }); return null; }
  return user;
}

async function requireModerator(request: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(request, reply); if (!user) return null;
  if (!user.roles.some((r: { role: string }) => MODERATION_ROLES.has(r.role))) {
    reply.code(403).send({ error: "forbidden" }); return null;
  }
  return user;
}

async function assessListingRisk(listingId: string) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing) return null;

  const signals: Array<{ code: string; weight: number; detail: string }> = [];
  const accountAgeDays = Math.floor((Date.now() - listing.seller.createdAt.getTime()) / 86_400_000);
  if (accountAgeDays < 3) signals.push({ code: "NEW_ACCOUNT", weight: 18, detail: "Compte créé depuis moins de 3 jours" });
  if (!listing.seller.emailVerifiedAt) signals.push({ code: "EMAIL_UNVERIFIED", weight: 20, detail: "Adresse e-mail non vérifiée" });
  if ((listing.priceMinor ?? 0) > 0 && (listing.priceMinor ?? 0) < 500) signals.push({ code: "VERY_LOW_PRICE", weight: 12, detail: "Prix inhabituellement bas" });

  const reports = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "TrustReport" WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('DISMISSED','CLOSED')`, listingId,
  );
  const reportCount = Number(reports[0]?.count ?? 0);
  if (reportCount >= 2) signals.push({ code: "MULTIPLE_REPORTS", weight: Math.min(35, reportCount * 10), detail: `${reportCount} signalements actifs` });

  const text = `${listing.title ?? ""} ${listing.description ?? ""}`.toLowerCase();
  if (["western union", "mandat cash", "telegram uniquement", "paiement hors plateforme", "crypto uniquement"].some((x) => text.includes(x))) {
    signals.push({ code: "OFF_PLATFORM_PAYMENT", weight: 45, detail: "Expression de paiement hors plateforme détectée" });
  }

  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0));
  const level = score >= 80 ? "CRITICAL" : score >= 55 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FraudRiskAssessment" ("id","subjectType","subjectId","score","level","signals","modelVersion") VALUES ($1,'LISTING',$2,$3,$4::"FraudRiskLevel",$5::jsonb,'rules-v1')`,
    randomUUID(), listingId, score, level, JSON.stringify(signals),
  );
  return { score, level, signals };
}

export async function registerModerationRoutes(app: FastifyInstance) {
  app.post("/reports", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({
      targetType: z.enum(["LISTING", "USER", "MESSAGE", "STORE"]),
      targetId: z.string().min(1).max(100),
      reason: z.enum(["SCAM", "COUNTERFEIT", "PROHIBITED_ITEM", "HARASSMENT", "SPAM", "MISLEADING", "DUPLICATE", "SAFETY", "OTHER"]),
      details: z.string().trim().max(2000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TrustReport" ("id","reporterId","targetType","targetId","reason","details") VALUES ($1,$2,$3::"ReportTargetType",$4,$5::"ReportReason",$6)`,
      id, user.id, parsed.data.targetType, parsed.data.targetId, parsed.data.reason, parsed.data.details ?? null,
    );

    let risk: Awaited<ReturnType<typeof assessListingRisk>> = null;
    if (parsed.data.targetType === "LISTING") risk = await assessListingRisk(parsed.data.targetId);
    const priority = risk?.level === "CRITICAL" ? 100 : risk?.level === "HIGH" ? 80 : risk?.level === "MEDIUM" ? 60 : 40;
    const caseId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ModerationCase" ("id","targetType","targetId","priority","riskScore") VALUES ($1,$2::"ReportTargetType",$3,$4,$5)`,
      caseId, parsed.data.targetType, parsed.data.targetId, priority, risk?.score ?? 0,
    );
    await prisma.$executeRawUnsafe(`INSERT INTO "ModerationCaseReport" ("caseId","reportId") VALUES ($1,$2)`, caseId, id);
    return reply.code(201).send({ report: { id, status: "OPEN" }, moderationCaseId: caseId, risk });
  });

  app.post("/trust/assess/listings/:id", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    const risk = await assessListingRisk(parsed.data.id);
    if (!risk) return reply.code(404).send({ error: "listing_not_found" });
    return reply.send({ risk });
  });

  app.get("/admin/moderation/cases", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "ModerationCase" WHERE "status" NOT IN ('RESOLVED','CLOSED') ORDER BY "priority" DESC, "createdAt" ASC LIMIT 100`,
    );
    return reply.send({ cases: rows });
  });

  app.post("/admin/moderation/cases/:id/decision", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({
      action: z.enum(["NONE","WARNING","HIDE_LISTING","SUSPEND_LISTING","REMOVE_LISTING","SUSPEND_USER","BAN_USER","RESTRICT_MESSAGING","STORE_SUSPEND"]),
      reasonCode: z.string().trim().min(2).max(120),
      statement: z.string().trim().min(10).max(3000),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const cases = await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ModerationCase" WHERE "id"=$1 LIMIT 1`, params.data.id);
    const c = cases[0]; if (!c) return reply.code(404).send({ error: "case_not_found" });
    if (["HIDE_LISTING","SUSPEND_LISTING","REMOVE_LISTING"].includes(body.data.action) && c.targetType === "LISTING") {
      await prisma.listing.updateMany({ where: { id: c.targetId }, data: { status: "SUSPENDED" } });
    }
    if (["SUSPEND_USER","BAN_USER"].includes(body.data.action) && c.targetType === "USER") {
      await prisma.user.updateMany({ where: { id: c.targetId }, data: { status: "SUSPENDED" } });
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "ModerationCase" SET "status"='RESOLVED',"decisionAction"=$1::"ModerationActionType","decisionReasonCode"=$2,"decisionStatement"=$3,"decidedByUserId"=$4,"decidedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$5`,
      body.data.action, body.data.reasonCode, body.data.statement, moderator.id, c.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ModerationActionLog" ("id","caseId","actorUserId","action","reasonCode","statement") VALUES ($1,$2,$3,$4::"ModerationActionType",$5,$6)`,
      randomUUID(), c.id, moderator.id, body.data.action, body.data.reasonCode, body.data.statement,
    );
    return reply.send({ resolved: true });
  });

  app.post("/moderation/cases/:id/appeals", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ statement: z.string().trim().min(20).max(4000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ModerationAppeal" ("id","caseId","appellantUserId","statement") VALUES ($1,$2,$3,$4)`, id, params.data.id, user.id, body.data.statement,
    );
    return reply.code(201).send({ appeal: { id, status: "OPEN" } });
  });

  app.post("/admin/moderation/appeals/:id/review", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ status: z.enum(["UPHELD","OVERTURNED","PARTIALLY_OVERTURNED"]), resolutionNote: z.string().trim().min(10).max(3000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(
      `UPDATE "ModerationAppeal" SET "status"=$1::"AppealStatus","reviewedByUserId"=$2,"resolutionNote"=$3,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4`,
      body.data.status, moderator.id, body.data.resolutionNote, params.data.id,
    );
    return reply.send({ reviewed: true, status: body.data.status });
  });
}
