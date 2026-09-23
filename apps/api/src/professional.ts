import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createPresignedUpload, makeStoredObjectPublic, publicObjectUrl, storageConfigured, uploadStoredObject, verifyStoredObject } from "./storage.js";
import { calculateTrustScore } from "./trust-score.js";
import { lookupPublicCompany } from "./company-registry.js";
import { ensureListingLifecycleSchema } from "./listing-lifecycle.js";
import { requireProfessionalContext, setProfessionalSector } from "./pro-suite.js";
import { enrichItems } from "./search.js";
import { notifyStoreIndexNow } from "./indexnow.js";
import { ensureFollowingSchema } from "./following.js";

const SESSION_COOKIE = "pa_session";

const STORE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_STORE_IMAGE_BYTES = 10 * 1024 * 1024;
function imageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/avif") return "avif";
  return "webp";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(request: FastifyRequest) {
  const value = request.headers.authorization;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,300})$/i.exec(value.trim());
  return match?.[1] ?? null;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE] ?? bearerToken(request);
  if (!token) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  return session.user;
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

async function uniqueStoreSlug(desired:string){
  const base=desired.slice(0,70);
  let candidate=base;
  for(let i=1;i<100;i+=1){const exists=await prisma.store.findUnique({where:{slug:candidate},select:{id:true}});if(!exists)return candidate;candidate=`${base}-${i+1}`.slice(0,80)}
  return `${base}-${Date.now().toString(36)}`.slice(0,80);
}

function luhnValid(value: string) {
  const digits = onlyDigits(value);
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

async function registryLookup(siren?: string, siret?: string) {
  const endpoint = process.env.PROFESSIONAL_REGISTRY_API_URL;
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (siret) url.searchParams.set("siret", siret);
  else if (siren) url.searchParams.set("siren", siren);
  const response = await fetch(url, { headers: process.env.PROFESSIONAL_REGISTRY_API_TOKEN ? { authorization: `Bearer ${process.env.PROFESSIONAL_REGISTRY_API_TOKEN}` } : undefined });
  if (!response.ok) throw new Error(`registry_${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

const businessSchema = z.object({
  legalName: z.string().trim().min(2).max(180),
  tradeName: z.string().trim().max(180).optional(),
  siren: z.string().trim().optional(),
  siret: z.string().trim().optional(),
  vatNumber: z.string().trim().max(32).optional(),
  legalForm: z.string().trim().max(100).optional(),
  nafCode: z.string().trim().max(16).optional(),
  headquartersAddress: z.string().trim().max(250).optional(),
  headquartersPostalCode: z.string().trim().max(16).optional(),
  headquartersCity: z.string().trim().max(120).optional(),
}).refine((data) => data.siren || data.siret, { message: "siren_or_siret_required" });

const storeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  description: z.string().trim().max(2500).optional(),
  logoUrl: z.string().url().max(500).optional(),
  coverUrl: z.string().url().max(500).optional(),
  websiteUrl: z.string().url().max(500).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().email().optional(),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(16).optional(),
  sector: z.enum(["automobile","immobilier","commerce","high-tech","occasion","services","vacances","autre"]).optional(),
});

async function ensureDefaultPlans() {
  const plans = [
    { code: "ESSENTIEL" as const, name: "Essentiel", monthlyPriceMinor: 990, maxActiveListings: 50, maxStores: 1, analyticsEnabled: false, featuredCreditsMonthly: 0 },
    { code: "PROFESSIONNEL" as const, name: "Professionnel", monthlyPriceMinor: 2490, maxActiveListings: 250, maxStores: 2, analyticsEnabled: true, autoRenewListings: true, featuredCreditsMonthly: 0, bulkImportEnabled: true, apiFeedEnabled: true },
    { code: "PREMIUM" as const, name: "Premium", monthlyPriceMinor: 4990, maxActiveListings: null, maxStores: 5, analyticsEnabled: true, autoRenewListings: true, prioritySupport: true, featuredCreditsMonthly: 0, bulkImportEnabled: true, apiFeedEnabled: true },
  ];
  await Promise.all(plans.map((plan) => prisma.professionalPlan.upsert({ where: { code: plan.code }, create: plan, update: {} })));
}

export async function registerProfessionalRoutes(app: FastifyInstance) {
  app.get("/pro/business/lookup", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;const q=z.object({identifier:z.string().trim().min(9).max(20)}).safeParse(request.query);if(!q.success)return reply.code(400).send({error:"invalid_identifier"});
    try{const company=await lookupPublicCompany(q.data.identifier);if(!company)return reply.code(404).send({error:"company_not_found"});return reply.send({company});}catch{return reply.code(502).send({error:"registry_unavailable"})}
  });
  app.post("/pro/business/quick-verify", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    const parsed=z.object({identifier:z.string().trim().min(9).max(20)}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_identifier"});
    const identifier=onlyDigits(parsed.data.identifier);if(![9,14].includes(identifier.length))return reply.code(400).send({error:"invalid_identifier"});
    let company;try{company=await lookupPublicCompany(identifier)}catch{return reply.code(502).send({error:"registry_unavailable"})}if(!company)return reply.code(404).send({error:"company_not_found"});if(company.active===false)return reply.code(409).send({error:"company_inactive"});
    const business=await prisma.$transaction(async tx=>{await tx.user.update({where:{id:user.id},data:{kind:"PROFESSIONNEL"}});const b=await tx.businessProfile.upsert({where:{userId:user.id},create:{userId:user.id,legalName:company.legalName,tradeName:company.tradeName??undefined,siren:company.siren,siret:company.siret??undefined,nafCode:company.nafCode??undefined,legalForm:company.legalFormCode??undefined,headquartersAddress:company.headquartersAddress??undefined,headquartersPostalCode:company.headquartersPostalCode??undefined,headquartersCity:company.headquartersCity??undefined,verificationStatus:"VERIFIED",verificationProvider:company.source,verificationReference:company.reference,verifiedAt:new Date(),lastRegistryCheckAt:new Date()},update:{legalName:company.legalName,tradeName:company.tradeName??undefined,siren:company.siren,siret:company.siret??undefined,nafCode:company.nafCode??undefined,legalForm:company.legalFormCode??undefined,headquartersAddress:company.headquartersAddress??undefined,headquartersPostalCode:company.headquartersPostalCode??undefined,headquartersCity:company.headquartersCity??undefined,verificationStatus:"VERIFIED",verificationProvider:company.source,verificationReference:company.reference,verifiedAt:new Date(),lastRegistryCheckAt:new Date()}});await tx.store.updateMany({where:{ownerId:user.id,status:"DRAFT"},data:{status:"ACTIVE",isVerified:true,publishedAt:new Date()}});return b});
    return reply.send({business,company,verified:true});
  });

  app.get("/pro/plans", async (_request, reply) => {
    await ensureDefaultPlans();
    const plans = await prisma.professionalPlan.findMany({ where: { isActive: true }, orderBy: { monthlyPriceMinor: "asc" } });
    return reply.send({ plans });
  });

  app.post("/pro/business", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = businessSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_business", details: parsed.error.flatten() });
    const siren = parsed.data.siren ? onlyDigits(parsed.data.siren) : undefined;
    const siret = parsed.data.siret ? onlyDigits(parsed.data.siret) : undefined;
    if (siren && (siren.length !== 9 || !luhnValid(siren))) return reply.code(400).send({ error: "invalid_siren" });
    if (siret && (siret.length !== 14 || !luhnValid(siret))) return reply.code(400).send({ error: "invalid_siret" });
    if (siren && siret && !siret.startsWith(siren)) return reply.code(400).send({ error: "siret_siren_mismatch" });

    const business = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { kind: "PROFESSIONNEL" } });
      return tx.businessProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...parsed.data, siren, siret, verificationStatus: "PENDING" },
        update: { ...parsed.data, siren, siret, verificationStatus: "PENDING", verifiedAt: null },
      });
    });
    return reply.send({ business });
  });

  app.post("/pro/business/verify", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const business = await prisma.businessProfile.findUnique({ where: { userId: user.id } });
    if (!business) return reply.code(404).send({ error: "business_not_found" });
    let registry: Record<string, any> | null = null;
    try { registry = await registryLookup(business.siren ?? undefined, business.siret ?? undefined); if(!registry) registry = await lookupPublicCompany(business.siret ?? business.siren ?? "") as any; } catch { return reply.code(502).send({ error: "registry_unavailable" }); }
    const verified = registry ? registry.active !== false && registry.valid !== false : false;
    const updated = await prisma.businessProfile.update({
      where: { id: business.id },
      data: {
        verificationStatus: verified ? "VERIFIED" : "PENDING",
        verificationProvider: registry ? String((registry as any).source ?? "registry_adapter") : null,
        verificationReference: registry && typeof (registry as any).reference === "string" ? String((registry as any).reference) : null,
        verifiedAt: verified ? new Date() : null,
        lastRegistryCheckAt: new Date(),
      },
    });
    if(verified) await prisma.store.updateMany({where:{ownerId:user.id,status:"DRAFT"},data:{status:"ACTIVE",isVerified:true,publishedAt:new Date()}});
    return reply.send({ business: updated, registryConfigured: true });
  });

  app.get("/pro/me", async (request, reply) => {
    const auth=await requireProfessionalContext(request,reply,"DASHBOARD");
    if(!auth)return;
    const data = await prisma.user.findUnique({
      where: { id: auth.ctx.ownerUserId },
      select: {
        id: true, email: true, kind: true,
        business: true,
        stores: { include: { _count: { select: { listings: true } } } },
        subscriptions: { where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } }, include: { plan: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return reply.send({ professional: data ? {...data, sector: auth.ctx.sector} : data, access: auth.ctx });
  });

  app.post("/pro/stores", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = storeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_store", details: parsed.error.flatten() });
    const business = await prisma.businessProfile.findUnique({ where: { userId: user.id } });
    if (!business) return reply.code(400).send({ error: "business_required" });
    const subscription = await prisma.professionalSubscription.findFirst({ where: { userId: user.id, OR:[{status:"ACTIVE"},{status:"TRIALING",trialEndsAt:{gt:new Date()}}] }, include: { plan: true }, orderBy: { createdAt: "desc" } });
    const currentCount = await prisma.store.count({ where: { ownerId: user.id, status: { not: "SUSPENDED" } } });
    const allowed = subscription?.plan.maxStores ?? 1;
    if (currentCount >= allowed) return reply.code(403).send({ error: "store_limit_reached", allowed });
    const {sector,...storeData}=parsed.data;const slug=await uniqueStoreSlug(storeData.slug);
    const store = await prisma.store.create({ data: { ownerId: user.id, businessId: business.id, ...storeData, slug, status: business.verificationStatus === "VERIFIED" ? "ACTIVE" : "DRAFT", isVerified: business.verificationStatus === "VERIFIED", publishedAt: business.verificationStatus === "VERIFIED" ? new Date() : null } });
    if(sector)await setProfessionalSector(user.id,sector,"STORE");
    notifyStoreIndexNow(store.id).catch(()=>undefined);
    return reply.code(201).send({ store });
  });

  app.patch("/pro/stores/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = storeSchema.partial().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const existing = await prisma.store.findFirst({ where: { id: params.data.id, ownerId: user.id } });
    if (!existing) return reply.code(404).send({ error: "store_not_found" });
    if(body.data.slug&&body.data.slug!==existing.slug){const conflict=await prisma.store.findUnique({where:{slug:body.data.slug},select:{id:true}});if(conflict&&conflict.id!==existing.id)return reply.code(409).send({error:"store_slug_already_used"})}
    const {sector,...storeData}=body.data;const store = await prisma.store.update({ where: { id: existing.id }, data: storeData });if(sector)await setProfessionalSector(user.id,sector,"STORE");
    notifyStoreIndexNow(store.id).catch(()=>undefined);
    return reply.send({ store });
  });

  app.post("/pro/stores/:id/assets/upload-intent", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ kind: z.enum(["logo","cover"]), mimeType: z.string().min(1), sizeBytes: z.number().int().positive() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!STORE_IMAGE_MIME_TYPES.has(body.data.mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    if (body.data.sizeBytes > MAX_STORE_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_STORE_IMAGE_BYTES });
    const store = await prisma.store.findFirst({ where: { id: params.data.id, ownerId: user.id }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "store_not_found" });
    const assetId = randomUUID();
    const objectKey = `stores/${store.id}/${body.data.kind}-${assetId}.${imageExtension(body.data.mimeType)}`;
    return reply.code(201).send({ assetId, objectKey, uploadUrl: await createPresignedUpload(objectKey, body.data.mimeType), method: "PUT", headers: { "content-type": body.data.mimeType }, expiresInSeconds: 600 });
  });

  app.post("/pro/stores/:id/assets/upload-direct", { bodyLimit: MAX_STORE_IMAGE_BYTES }, async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const kind = z.enum(["logo","cover"]).safeParse(request.headers["x-store-asset-kind"]);
    const mimeType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (!params.success || !kind.success) return reply.code(400).send({ error: "invalid_request" });
    if (!mimeType || !STORE_IMAGE_MIME_TYPES.has(mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length < 1) return reply.code(400).send({ error: "empty_media" });
    if (body.length > MAX_STORE_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_STORE_IMAGE_BYTES });
    const store = await prisma.store.findFirst({ where: { id: params.data.id, ownerId: user.id }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "store_not_found" });
    const objectKey = `stores/${store.id}/${kind.data}-${randomUUID()}.${imageExtension(mimeType)}`;
    const url = await uploadStoredObject(objectKey, mimeType, body);
    const updated = await prisma.store.update({ where: { id: store.id }, data: kind.data === "logo" ? { logoUrl: url } : { coverUrl: url } });
    notifyStoreIndexNow(updated.id).catch(()=>undefined);
    return reply.send({ store: updated, url });
  });

  app.post("/pro/stores/:id/assets/confirm", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ kind: z.enum(["logo","cover"]), objectKey: z.string().min(1).max(500) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const store = await prisma.store.findFirst({ where: { id: params.data.id, ownerId: user.id }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "store_not_found" });
    if (!body.data.objectKey.startsWith(`stores/${store.id}/${body.data.kind}-`)) return reply.code(400).send({ error: "invalid_object_key" });
    const stored = await verifyStoredObject(body.data.objectKey);
    if (!stored.sizeBytes || stored.sizeBytes > MAX_STORE_IMAGE_BYTES || !stored.mimeType || !STORE_IMAGE_MIME_TYPES.has(stored.mimeType)) return reply.code(422).send({ error: "stored_media_mismatch" });
    await makeStoredObjectPublic(body.data.objectKey);
    const url = publicObjectUrl(body.data.objectKey);
    const updated = await prisma.store.update({ where: { id: store.id }, data: body.data.kind === "logo" ? { logoUrl: url } : { coverUrl: url } });
    notifyStoreIndexNow(updated.id).catch(()=>undefined);
    return reply.send({ store: updated, url });
  });

  app.get("/pro/analytics", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (user.kind !== "PROFESSIONNEL") return reply.code(403).send({ error: "professional_account_required" });
    const query = z.object({ days: z.coerce.number().int().refine(v => [7,30,90].includes(v)).default(30) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_period" });
    const periodDays = query.data.days;
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
    const previousSince = new Date(Date.now() - periodDays * 2 * 24 * 60 * 60 * 1000);
    await ensureFollowingSchema();
    const [subscription, statusRows, storeRows, conversationCount, pendingOffers, orderRows, recentOrders, favoriteRows, topListings, viewSeries, followerSummaryRows, followerStoreRows, followerListingRows] = await Promise.all([
      prisma.professionalSubscription.findFirst({ where: { userId: user.id, OR:[{status:{in:["ACTIVE","PAST_DUE"]}},{status:"TRIALING",trialEndsAt:{gt:new Date()}}] }, include: { plan: true }, orderBy: { createdAt: "desc" } }),
      prisma.listing.groupBy({ by: ["status"], where: { sellerId: user.id }, _count: { _all: true } }),
      prisma.store.findMany({ where: { ownerId: user.id }, select: { id: true, name: true, slug: true, status: true, _count: { select: { listings: true } } }, orderBy: { createdAt: "asc" } }),
      prisma.conversation.count({ where: { sellerId: user.id, createdAt: { gte: since } } }),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "Offer" o JOIN "Listing" l ON l."id"=o."listingId" WHERE o."recipientId"=$1 AND o."status"='PENDING' AND l."sellerId"=$1`,user.id),
      prisma.$queryRawUnsafe<Array<{orders:number;completed:number;revenue:bigint;average:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "status" = ANY($2::"OrderStatus"[]))::int AS orders, COUNT(*) FILTER (WHERE "status"='COMPLETED')::int AS completed, COALESCE(SUM("sellerNetMinor") FILTER (WHERE "status" = ANY($2::"OrderStatus"[])),0)::bigint AS revenue, COALESCE(AVG("sellerNetMinor") FILTER (WHERE "status" = ANY($2::"OrderStatus"[])),0)::bigint AS average FROM "MarketplaceOrder" WHERE "sellerId"=$1 AND "createdAt">=$3`, user.id, ["PAID","PROCESSING","SHIPPED","DELIVERED","COMPLETED"], since),
      prisma.$queryRawUnsafe<Array<{day:Date;orders:number;revenue:bigint}>>(`SELECT DATE_TRUNC('day',"createdAt") AS day, COUNT(*)::int AS orders, COALESCE(SUM("sellerNetMinor"),0)::bigint AS revenue FROM "MarketplaceOrder" WHERE "sellerId"=$1 AND "createdAt">=$2 AND "status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED') GROUP BY 1 ORDER BY 1 ASC`, user.id, since),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "FavoriteListing" f JOIN "Listing" l ON l."id"=f."listingId" WHERE l."sellerId"=$1 AND f."createdAt">=$2`, user.id, since),
      prisma.$queryRawUnsafe<Array<{id:string;title:string|null;slug:string|null;status:string;priceMinor:number|null;currency:string;favorites:bigint;conversations:bigint;offers:bigint;views:bigint;orders:bigint;revenue:bigint}>>(`
        SELECT l."id",l."title",l."slug",l."status"::text,l."priceMinor",l."currency",
          (SELECT COUNT(*)::bigint FROM "FavoriteListing" f WHERE f."listingId"=l."id" AND f."createdAt">=$2) AS favorites,
          (SELECT COUNT(*)::bigint FROM "Conversation" c WHERE c."listingId"=l."id" AND c."createdAt">=$2) AS conversations,
          (SELECT COUNT(*)::bigint FROM "Offer" o WHERE o."listingId"=l."id" AND o."createdAt">=$2) AS offers,
          (SELECT COUNT(*)::bigint FROM "ListingView" v WHERE v."listingId"=l."id" AND v."createdAt">=$2) AS views,
          (SELECT COUNT(*)::bigint FROM "MarketplaceOrder" o WHERE o."listingId"=l."id" AND o."sellerId"=$1 AND o."createdAt">=$2 AND o."status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')) AS orders,
          (SELECT COALESCE(SUM(o."sellerNetMinor"),0)::bigint FROM "MarketplaceOrder" o WHERE o."listingId"=l."id" AND o."sellerId"=$1 AND o."createdAt">=$2 AND o."status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','COMPLETED')) AS revenue
        FROM "Listing" l
        WHERE l."sellerId"=$1
        ORDER BY views DESC, conversations DESC, favorites DESC, offers DESC, orders DESC, l."updatedAt" DESC
        LIMIT 10`, user.id, since),
      prisma.$queryRawUnsafe<Array<{day:Date;views:bigint}>>(`SELECT DATE_TRUNC('day',v."createdAt") AS day,COUNT(*)::bigint AS views FROM "ListingView" v JOIN "Listing" l ON l."id"=v."listingId" WHERE l."sellerId"=$1 AND v."createdAt">=$2 GROUP BY 1 ORDER BY 1`,user.id,since),
      prisma.$queryRawUnsafe<Array<{totalUnique:bigint;new7:bigint;previous7:bigint;new30:bigint;previous30:bigint;periodNew:bigint;periodPrevious:bigint;profileTotal:bigint;profileNew7:bigint;profileNew30:bigint}>>(`
        WITH relevant AS (
          SELECT f.* FROM "FollowSubscription" f
          WHERE (f."targetType"='USER' AND f."targetId"=$1)
             OR (f."targetType"='STORE' AND f."targetId" IN (SELECT "id" FROM "Store" WHERE "ownerId"=$1))
        )
        SELECT
          COUNT(DISTINCT "followerUserId")::bigint AS "totalUnique",
          COUNT(DISTINCT "followerUserId") FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '7 days')::bigint AS "new7",
          COUNT(DISTINCT "followerUserId") FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '14 days' AND "createdAt"<CURRENT_TIMESTAMP-INTERVAL '7 days')::bigint AS "previous7",
          COUNT(DISTINCT "followerUserId") FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days')::bigint AS "new30",
          COUNT(DISTINCT "followerUserId") FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '60 days' AND "createdAt"<CURRENT_TIMESTAMP-INTERVAL '30 days')::bigint AS "previous30",
          COUNT(DISTINCT "followerUserId") FILTER (WHERE "createdAt">=$2)::bigint AS "periodNew",
          COUNT(DISTINCT "followerUserId") FILTER (WHERE "createdAt">=$3 AND "createdAt"<$2)::bigint AS "periodPrevious",
          COUNT(*) FILTER (WHERE "targetType"='USER' AND "targetId"=$1)::bigint AS "profileTotal",
          COUNT(*) FILTER (WHERE "targetType"='USER' AND "targetId"=$1 AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '7 days')::bigint AS "profileNew7",
          COUNT(*) FILTER (WHERE "targetType"='USER' AND "targetId"=$1 AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days')::bigint AS "profileNew30"
        FROM relevant`,user.id,since,previousSince),
      prisma.$queryRawUnsafe<Array<{id:string;followers:bigint;new7:bigint;new30:bigint}>>(`
        SELECT s."id",
          COUNT(f."id")::bigint AS followers,
          COUNT(f."id") FILTER (WHERE f."createdAt">=CURRENT_TIMESTAMP-INTERVAL '7 days')::bigint AS "new7",
          COUNT(f."id") FILTER (WHERE f."createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days')::bigint AS "new30"
        FROM "Store" s
        LEFT JOIN "FollowSubscription" f ON f."targetType"='STORE' AND f."targetId"=s."id"
        WHERE s."ownerId"=$1
        GROUP BY s."id"`,user.id),
      prisma.$queryRawUnsafe<Array<{id:string;title:string|null;slug:string|null;status:string;followers:bigint;periodFollowers:bigint}>>(`
        SELECT l."id",l."title",l."slug",l."status"::text,
          COUNT(f."id")::bigint AS followers,
          COUNT(f."id") FILTER (WHERE f."createdAt">=$2)::bigint AS "periodFollowers"
        FROM "FollowSubscription" f
        JOIN "Listing" l ON l."id"=f."sourceListingId"
        WHERE l."sellerId"=$1 AND f."sourceListingId" IS NOT NULL
        GROUP BY l."id",l."title",l."slug",l."status"
        ORDER BY "periodFollowers" DESC,followers DESC,MAX(f."createdAt") DESC
        LIMIT 10`,user.id,since),
    ]);
    const statuses: Record<string,number> = { DRAFT:0,PENDING:0,PUBLISHED:0,SUSPENDED:0,SOLD:0,EXPIRED:0 };
    for (const row of statusRows) statuses[row.status] = row._count._all;
    const ord = orderRows[0];
    const followerSummary=followerSummaryRows[0];
    const growth=(current:number,previous:number)=>previous>0?Math.round(((current-previous)/previous)*100):current>0?null:0;
    const followerStores=new Map(followerStoreRows.map(row=>[row.id,{followers:Number(row.followers),new7:Number(row.new7),new30:Number(row.new30)}]));
    const new7=Number(followerSummary?.new7??0n),previous7=Number(followerSummary?.previous7??0n),new30=Number(followerSummary?.new30??0n),previous30=Number(followerSummary?.previous30??0n),periodNew=Number(followerSummary?.periodNew??0n),periodPrevious=Number(followerSummary?.periodPrevious??0n);
    return reply.send({
      analyticsEnabled: Boolean(subscription?.plan.analyticsEnabled),
      plan: subscription?.plan ? { name: subscription.plan.name, code: subscription.plan.code } : null,
      periodDays,
      listings: statuses,
      stores: storeRows,
      followers: {
        total: Number(followerSummary?.totalUnique??0n),
        new7, previous7, growth7Percent:growth(new7,previous7),
        new30, previous30, growth30Percent:growth(new30,previous30),
        periodNew, periodPrevious, growthPeriodPercent:growth(periodNew,periodPrevious),
        profile:{total:Number(followerSummary?.profileTotal??0n),new7:Number(followerSummary?.profileNew7??0n),new30:Number(followerSummary?.profileNew30??0n)},
        stores:storeRows.map(store=>({id:store.id,...(followerStores.get(store.id)??{followers:0,new7:0,new30:0})})),
        topListings:followerListingRows.map(row=>({...row,followers:Number(row.followers),periodFollowers:Number(row.periodFollowers)})),
      },
      engagement: { conversations: conversationCount, pendingOffers: Number(pendingOffers[0]?.count ?? 0n), favorites: Number(favoriteRows[0]?.count ?? 0n) },
      sales: { orders: Number(ord?.orders ?? 0), completed: Number(ord?.completed ?? 0), revenueMinor: Number(ord?.revenue ?? 0n), averageOrderMinor: Number(ord?.average ?? 0n) },
      series: recentOrders.map(r => ({ day: r.day.toISOString().slice(0,10), orders: Number(r.orders), revenueMinor: Number(r.revenue) })),
      viewSeries: viewSeries.map(r=>({day:r.day.toISOString().slice(0,10),views:Number(r.views)})),
      topListings: topListings.map(x => { const { revenue, ...item } = x; return { ...item, favorites:Number(x.favorites), conversations:Number(x.conversations), offers:Number(x.offers), views:Number(x.views), orders:Number(x.orders), revenueMinor:Number(revenue) }; }),
    });
  });

  app.delete("/pro/stores/:id/listings/:listingId", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1), listingId: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, sellerId: user.id, storeId: parsed.data.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const updated = await prisma.listing.update({ where: { id: listing.id }, data: { storeId: null } });
    return reply.send({ listing: updated });
  });

  app.post("/pro/stores/:id/listings/:listingId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = z.object({ id: z.string().min(1), listingId: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const store = await prisma.store.findFirst({ where: { id: parsed.data.id, ownerId: user.id } });
    if (!store) return reply.code(404).send({ error: "store_not_found" });
    if (store.status === "SUSPENDED") return reply.code(409).send({ error: "store_suspended" });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, sellerId: user.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const updated = await prisma.listing.update({ where: { id: listing.id }, data: { storeId: store.id } });
    return reply.send({ listing: updated });
  });

  app.post("/pro/listings/bulk", async (request, reply) => {
    const auth=await requireProfessionalContext(request,reply,"LISTINGS"); if(!auth)return;
    const ownerId=auth.ctx.ownerUserId;
    const body = z.object({
      listingIds: z.array(z.string().min(1)).min(1).max(100).transform(ids => [...new Set(ids)]),
      action: z.enum(["PAUSE","RESUME","SOLD","ATTACH_STORE","DETACH_STORE","SET_PRICE","EXTEND_30"]),
      storeId: z.string().min(1).optional(),
      priceMinor: z.number().int().min(0).max(100_000_000_000).optional(),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    if(body.data.action==="SET_PRICE"&&body.data.priceMinor==null)return reply.code(400).send({error:"price_required"});
    const listings = await prisma.listing.findMany({ where: { id: { in: body.data.listingIds }, sellerId: ownerId }, select: { id:true,status:true,storeId:true } });
    if (listings.length !== body.data.listingIds.length) {
      const found = new Set(listings.map(x=>x.id));
      return reply.code(404).send({ error:"listing_not_found", missing:body.data.listingIds.filter(id=>!found.has(id)) });
    }
    let targetStoreId:string|null|undefined;
    if (body.data.action === "ATTACH_STORE") {
      if (!body.data.storeId) return reply.code(400).send({ error:"store_required" });
      const store = await prisma.store.findFirst({ where:{ id:body.data.storeId, ownerId } });
      if (!store) return reply.code(404).send({ error:"store_not_found" });
      if (store.status === "SUSPENDED") return reply.code(409).send({ error:"store_suspended" });
      targetStoreId=store.id;
    } else if (body.data.action === "DETACH_STORE") targetStoreId=null;
    const expected:Record<string,string|undefined>={PAUSE:"PUBLISHED",RESUME:"SUSPENDED",SOLD:"PUBLISHED"};
    const required=expected[body.data.action];
    if(required){const invalid=listings.filter(x=>x.status!==required).map(x=>({id:x.id,status:x.status}));if(invalid.length)return reply.code(409).send({error:"invalid_bulk_transition",action:body.data.action,requiredStatus:required,invalid})}
    if(body.data.action==="EXTEND_30"){
      const invalid=listings.filter(x=>x.status!=="PUBLISHED").map(x=>({id:x.id,status:x.status}));if(invalid.length)return reply.code(409).send({error:"invalid_bulk_transition",action:"EXTEND_30",requiredStatus:"PUBLISHED",invalid});
      const subscription=await prisma.professionalSubscription.findFirst({where:{userId:ownerId,OR:[{status:"ACTIVE"},{status:"TRIALING",trialEndsAt:{gt:new Date()}}]},include:{plan:true},orderBy:{createdAt:"desc"}});if(!subscription?.plan.autoRenewListings)return reply.code(403).send({error:"auto_renew_not_in_plan"});
      await ensureListingLifecycleSchema();const ids=listings.map(x=>x.id);await prisma.$executeRawUnsafe(`UPDATE "ListingLifecycle" SET "expiresAt"=GREATEST("expiresAt",CURRENT_TIMESTAMP)+INTERVAL '30 days',"renewalCount"="renewalCount"+1,"lastRenewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=ANY($1::text[])`,ids);return reply.send({action:"EXTEND_30",count:ids.length,updated:ids.map(id=>({id}))});
    }
    const updated = await prisma.$transaction(listings.map(listing => {
      if (body.data.action === "PAUSE") return prisma.listing.update({where:{id:listing.id},data:{status:"SUSPENDED"},select:{id:true,status:true,storeId:true,priceMinor:true}});
      if (body.data.action === "RESUME") return prisma.listing.update({where:{id:listing.id},data:{status:"PENDING",slug:null},select:{id:true,status:true,storeId:true,priceMinor:true}});
      if (body.data.action === "SOLD") return prisma.listing.update({where:{id:listing.id},data:{status:"SOLD"},select:{id:true,status:true,storeId:true,priceMinor:true}});
      if (body.data.action === "SET_PRICE") return prisma.listing.update({where:{id:listing.id},data:{priceMinor:body.data.priceMinor!},select:{id:true,status:true,storeId:true,priceMinor:true}});
      return prisma.listing.update({where:{id:listing.id},data:{storeId:targetStoreId},select:{id:true,status:true,storeId:true,priceMinor:true}});
    }));
    return reply.send({updated,action:body.data.action,count:updated.length});
  });

  app.get("/public/stores", async (_request, reply) => {
    const stores = await prisma.store.findMany({
      where: { status: "ACTIVE", listings: { some: { status: "PUBLISHED" } } },
      select: {
        id: true, slug: true, name: true, description: true, logoUrl: true, coverUrl: true, city: true, postalCode: true, isVerified: true, updatedAt: true,
        business: { select: { verificationStatus: true, siret: true, nafCode: true } },
        listings: {
          where: { status: "PUBLISHED" },
          select: {
            category: {
              select: {
                name: true, slug: true, domain: true,
                parent: { select: { name: true, slug: true, parent: { select: { name: true, slug: true } } } },
              },
            },
          },
          orderBy: { publishedAt: "desc" },
          take: 40,
        },
        _count: { select: { listings: { where: { status: "PUBLISHED" } } } },
      },
      orderBy: [{ isVerified: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
      take: 240,
    });
    const mapped = stores.map(store => {
      const sectorMap = new Map<string, { slug: string; name: string; count: number }>();
      for (const listing of store.listings) {
        const category = listing.category;
        const root = category.parent?.parent ?? category.parent ?? category;
        const existing = sectorMap.get(root.slug);
        sectorMap.set(root.slug, { slug: root.slug, name: root.name, count: (existing?.count ?? 0) + 1 });
      }
      const sectors = [...sectorMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));
      const siretVerified = store.business?.verificationStatus === "VERIFIED" && Boolean(store.business?.siret);
      return {
        id: store.id, slug: store.slug, name: store.name, description: store.description, logoUrl: store.logoUrl, coverUrl: store.coverUrl,
        city: store.city, postalCode: store.postalCode, updatedAt: store.updatedAt, activeListings: store._count.listings,
        verified: store.isVerified || store.business?.verificationStatus === "VERIFIED",
        siretVerified, nafCode: store.business?.nafCode ?? null,
        primarySector: sectors[0] ?? null,
        sectors,
      };
    });
    return reply.send({ stores: mapped, total: mapped.length });
  });

  app.get("/public/stores/:slug", async (request, reply) => {
    const parsed = z.object({ slug: z.string().min(1).max(80) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_slug" });
    const store = await prisma.store.findFirst({
      where: { slug: parsed.data.slug, status: "ACTIVE" },
      include: {
        owner: { select: { id: true, createdAt: true } },
        business: { select: { legalName: true, tradeName: true, siren: true, siret: true, verificationStatus: true } },
        listings: { where: { status: "PUBLISHED" }, select: { id: true, sellerId: true, title: true, slug: true, priceMinor: true, currency: true, city: true, publishedAt: true, category: { select: { name: true, slug: true, domain: true } }, vehicle: { select: { modelYear: true, mileageKm: true, fuel: true } }, property: { select: { surfaceM2: true, rooms: true, transactionType: true } } }, orderBy: { publishedAt: "desc" }, take: 48 },
      },
    });
    if (!store) return reply.code(404).send({ error: "store_not_found" });
    const [enrichedListings, reviewRows, completedRows, recentReviews, activeListingRows] = await Promise.all([
      enrichItems(store.listings),
      prisma.$queryRawUnsafe<Array<{count:bigint;average:number|null}>>(`SELECT COUNT(*)::bigint AS "count",AVG(r."rating")::float AS "average" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' WHERE r."revieweeId"=$1 AND r."direction"='BUYER_TO_SELLER'`, store.ownerId),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "MarketplaceOrder" WHERE "sellerId"=$1 AND "status"='COMPLETED'`, store.ownerId),
      prisma.$queryRawUnsafe<Array<{id:string;rating:number;comment:string|null;createdAt:Date;reviewerName:string}>>(`SELECT r."id",r."rating",r."comment",r."createdAt",COALESCE(p."displayName",p."firstName",'Membre Petit Annonces') AS "reviewerName" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' LEFT JOIN "UserProfile" p ON p."userId"=r."reviewerId" WHERE r."revieweeId"=$1 AND r."direction"='BUYER_TO_SELLER' AND r."comment" IS NOT NULL AND length(trim(r."comment"))>0 ORDER BY r."createdAt" DESC LIMIT 6`,store.ownerId),
      prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "Listing" WHERE "storeId"=$1 AND "status"='PUBLISHED'`,store.id),
    ]);
    const reviewCount = Number(reviewRows[0]?.count ?? 0n);
    const reviewAverage = reviewRows[0]?.average ?? null;
    const completedSales = Number(completedRows[0]?.count ?? 0n);
    const activeListings = Number(activeListingRows[0]?.count ?? 0n);
    const verified = store.isVerified || store.business?.verificationStatus === "VERIFIED";
    const trust = calculateTrustScore({ verified, reviewCount, reviewAverage, completedSales, memberSince: store.owner.createdAt });
    return reply.send({ store: { ...store, activeListings, listings: enrichedListings, reputation: { reviewCount, reviewAverage, completedSales, trust, recentReviews } } });
  });
}
