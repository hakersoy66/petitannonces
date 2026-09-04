import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const COMPLIANCE_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "COMPLIANCE", "SUPPORT"]);

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

async function requireCompliance(request: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(request, reply); if (!user) return null;
  if (!user.roles.some((r: { role: string }) => COMPLIANCE_ROLES.has(r.role))) { reply.code(403).send({ error: "forbidden" }); return null; }
  return user;
}

export async function registerComplianceRoutes(app: FastifyInstance) {
  app.get("/legal/documents", async (_request, reply) => {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","code","version","title","effectiveAt","urlPath" FROM "LegalDocumentVersion" WHERE "isActive"=TRUE ORDER BY "code" ASC,"effectiveAt" DESC`);
    return reply.send({ documents: rows });
  });

  app.post("/legal/accept", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ documentId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const ip = String(request.ip ?? "");
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LegalAcceptance" ("id","userId","documentId","ipHash","userAgent") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("userId","documentId") DO NOTHING`,
      randomUUID(), user.id, parsed.data.documentId, ip ? sha256(ip) : null, request.headers["user-agent"]?.slice(0, 500) ?? null,
    );
    return reply.code(201).send({ accepted: true });
  });

  app.post("/privacy/cookies", async (request, reply) => {
    const user = await currentUser(request);
    const parsed = z.object({
      anonymousId: z.string().min(8).max(120).optional(),
      policyVersion: z.string().min(1).max(40),
      source: z.enum(["WEB","IOS","ANDROID"]).default("WEB"),
      choices: z.object({ analytics: z.boolean(), personalization: z.boolean(), advertising: z.boolean() }),
    }).safeParse(request.body);
    if (!parsed.success || (!user && !parsed.data.anonymousId)) return reply.code(400).send({ error: "invalid_request" });
    const ownerId = user?.id ?? null;
    for (const [purpose, granted] of [["ANALYTICS", parsed.data.choices.analytics],["PERSONALIZATION", parsed.data.choices.personalization],["ADVERTISING", parsed.data.choices.advertising]] as const) {
      await prisma.$executeRawUnsafe(`INSERT INTO "CookieConsent" ("id","userId","anonymousId","purpose","granted","policyVersion","source","withdrawnAt") VALUES ($1,$2,$3,$4::"ConsentPurpose",$5,$6,$7,$8)`, randomUUID(), ownerId, parsed.data.anonymousId ?? null, purpose, granted, parsed.data.policyVersion, parsed.data.source, granted ? null : new Date());
    }
    return reply.send({ saved: true });
  });

  app.post("/privacy/requests", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ type: z.enum(["ACCESS","EXPORT","RECTIFICATION","ERASURE","RESTRICTION","OBJECTION"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const id = randomUUID();
    const ref = `PR-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6).toUpperCase()}`;
    const responseDueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.$executeRawUnsafe(`INSERT INTO "PrivacyDataRequest" ("id","userId","type","requestReference","responseDueAt") VALUES ($1,$2,$3::"DataRequestType",$4,$5)`, id, user.id, parsed.data.type, ref, responseDueAt);
    return reply.code(201).send({ request: { id, reference: ref, status: "OPEN", responseDueAt } });
  });

  app.get("/privacy/requests", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","type","status","requestReference","requestedAt","responseDueAt","completedAt" FROM "PrivacyDataRequest" WHERE "userId"=$1 ORDER BY "requestedAt" DESC`, user.id);
    return reply.send({ requests: rows });
  });

  app.put("/compliance/tax-profile", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ taxCountry: z.string().length(2).default("FR"), tin: z.string().trim().max(80).optional(), birthDate: z.coerce.date().optional(), birthPlace: z.string().trim().max(160).optional(), businessRegistrationNumber: z.string().trim().max(80).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(`INSERT INTO "SellerTaxProfile" ("id","userId","taxCountry","tin","birthDate","birthPlace","businessRegistrationNumber") VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT ("userId") DO UPDATE SET "taxCountry"=EXCLUDED."taxCountry","tin"=EXCLUDED."tin","birthDate"=EXCLUDED."birthDate","birthPlace"=EXCLUDED."birthPlace","businessRegistrationNumber"=EXCLUDED."businessRegistrationNumber","updatedAt"=CURRENT_TIMESTAMP`, randomUUID(), user.id, parsed.data.taxCountry.toUpperCase(), parsed.data.tin ?? null, parsed.data.birthDate ?? null, parsed.data.birthPlace ?? null, parsed.data.businessRegistrationNumber ?? null);
    return reply.send({ saved: true, dac7Status: "PENDING" });
  });

  app.put("/listings/:id/product-safety", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ manufacturerName: z.string().trim().max(200).optional(), manufacturerPostalAddress: z.string().trim().max(500).optional(), manufacturerEmail: z.string().email().optional(), responsiblePersonName: z.string().trim().max(200).optional(), responsiblePersonPostalAddress: z.string().trim().max(500).optional(), responsiblePersonEmail: z.string().email().optional(), productIdentifier: z.string().trim().max(160).optional(), model: z.string().trim().max(160).optional(), ean: z.string().trim().max(32).optional(), ceMarked: z.boolean().optional(), safetyWarning: z.string().trim().max(3000).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const d = body.data;
    await prisma.$executeRawUnsafe(`INSERT INTO "ListingProductSafety" ("id","listingId","manufacturerName","manufacturerPostalAddress","manufacturerEmail","responsiblePersonName","responsiblePersonPostalAddress","responsiblePersonEmail","productIdentifier","model","ean","ceMarked","safetyWarning") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT ("listingId") DO UPDATE SET "manufacturerName"=EXCLUDED."manufacturerName","manufacturerPostalAddress"=EXCLUDED."manufacturerPostalAddress","manufacturerEmail"=EXCLUDED."manufacturerEmail","responsiblePersonName"=EXCLUDED."responsiblePersonName","responsiblePersonPostalAddress"=EXCLUDED."responsiblePersonPostalAddress","responsiblePersonEmail"=EXCLUDED."responsiblePersonEmail","productIdentifier"=EXCLUDED."productIdentifier","model"=EXCLUDED."model","ean"=EXCLUDED."ean","ceMarked"=EXCLUDED."ceMarked","safetyWarning"=EXCLUDED."safetyWarning","updatedAt"=CURRENT_TIMESTAMP`, randomUUID(), listing.id, d.manufacturerName ?? null, d.manufacturerPostalAddress ?? null, d.manufacturerEmail ?? null, d.responsiblePersonName ?? null, d.responsiblePersonPostalAddress ?? null, d.responsiblePersonEmail ?? null, d.productIdentifier ?? null, d.model ?? null, d.ean ?? null, d.ceMarked ?? null, d.safetyWarning ?? null);
    return reply.send({ saved: true });
  });

  app.put("/listings/:id/consumer-disclosure", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ sellerIsTrader: z.boolean(), withdrawalRightApplies: z.boolean().optional(), withdrawalPeriodDays: z.number().int().min(0).max(365).optional(), withdrawalExceptionCode: z.string().max(120).optional(), legalGuaranteeNotice: z.string().max(3000).optional(), mediationEntityName: z.string().max(200).optional(), mediationEntityUrl: z.string().url().optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const d = body.data;
    await prisma.$executeRawUnsafe(`INSERT INTO "TraderConsumerDisclosure" ("id","listingId","sellerIsTrader","withdrawalRightApplies","withdrawalPeriodDays","withdrawalExceptionCode","legalGuaranteeNotice","mediationEntityName","mediationEntityUrl") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT ("listingId") DO UPDATE SET "sellerIsTrader"=EXCLUDED."sellerIsTrader","withdrawalRightApplies"=EXCLUDED."withdrawalRightApplies","withdrawalPeriodDays"=EXCLUDED."withdrawalPeriodDays","withdrawalExceptionCode"=EXCLUDED."withdrawalExceptionCode","legalGuaranteeNotice"=EXCLUDED."legalGuaranteeNotice","mediationEntityName"=EXCLUDED."mediationEntityName","mediationEntityUrl"=EXCLUDED."mediationEntityUrl","updatedAt"=CURRENT_TIMESTAMP`, randomUUID(), listing.id, d.sellerIsTrader, d.withdrawalRightApplies ?? null, d.withdrawalPeriodDays ?? null, d.withdrawalExceptionCode ?? null, d.legalGuaranteeNotice ?? null, d.mediationEntityName ?? null, d.mediationEntityUrl ?? null);
    return reply.send({ saved: true });
  });

  app.get("/admin/compliance/privacy-requests", async (request, reply) => {
    const admin = await requireCompliance(request, reply); if (!admin) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "PrivacyDataRequest" WHERE "status" NOT IN ('COMPLETED','REJECTED','CANCELED') ORDER BY "responseDueAt" ASC NULLS LAST LIMIT 100`);
    return reply.send({ requests: rows });
  });
}
