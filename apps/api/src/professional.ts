import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
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
});

async function ensureDefaultPlans() {
  const plans = [
    { code: "ESSENTIEL" as const, name: "Essentiel", monthlyPriceMinor: 990, maxActiveListings: 50, maxStores: 1, analyticsEnabled: false, featuredCreditsMonthly: 0 },
    { code: "PROFESSIONNEL" as const, name: "Professionnel", monthlyPriceMinor: 2490, maxActiveListings: 250, maxStores: 2, analyticsEnabled: true, autoRenewListings: true, featuredCreditsMonthly: 5, bulkImportEnabled: true },
    { code: "PREMIUM" as const, name: "Premium", monthlyPriceMinor: 4990, maxActiveListings: null, maxStores: 5, analyticsEnabled: true, autoRenewListings: true, prioritySupport: true, featuredCreditsMonthly: 15, bulkImportEnabled: true, apiFeedEnabled: true },
  ];
  await Promise.all(plans.map((plan) => prisma.professionalPlan.upsert({ where: { code: plan.code }, create: plan, update: plan })));
}

export async function registerProfessionalRoutes(app: FastifyInstance) {
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
    let registry: Record<string, unknown> | null = null;
    try { registry = await registryLookup(business.siren ?? undefined, business.siret ?? undefined); } catch { return reply.code(502).send({ error: "registry_unavailable" }); }
    const verified = registry ? registry.active !== false && registry.valid !== false : false;
    const updated = await prisma.businessProfile.update({
      where: { id: business.id },
      data: {
        verificationStatus: verified ? "VERIFIED" : "PENDING",
        verificationProvider: registry ? "registry_adapter" : null,
        verificationReference: registry && typeof registry.reference === "string" ? registry.reference : null,
        verifiedAt: verified ? new Date() : null,
        lastRegistryCheckAt: new Date(),
      },
    });
    return reply.send({ business: updated, registryConfigured: Boolean(process.env.PROFESSIONAL_REGISTRY_API_URL) });
  });

  app.get("/pro/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const data = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, kind: true,
        business: true,
        stores: { include: { _count: { select: { listings: true } } } },
        subscriptions: { where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } }, include: { plan: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    return reply.send({ professional: data });
  });

  app.post("/pro/stores", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = storeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_store", details: parsed.error.flatten() });
    const business = await prisma.businessProfile.findUnique({ where: { userId: user.id } });
    if (!business) return reply.code(400).send({ error: "business_required" });
    const subscription = await prisma.professionalSubscription.findFirst({ where: { userId: user.id, status: { in: ["TRIALING", "ACTIVE"] } }, include: { plan: true }, orderBy: { createdAt: "desc" } });
    const currentCount = await prisma.store.count({ where: { ownerId: user.id, status: { not: "SUSPENDED" } } });
    const allowed = subscription?.plan.maxStores ?? 1;
    if (currentCount >= allowed) return reply.code(403).send({ error: "store_limit_reached", allowed });
    const store = await prisma.store.create({ data: { ownerId: user.id, businessId: business.id, ...parsed.data, status: business.verificationStatus === "VERIFIED" ? "ACTIVE" : "DRAFT", isVerified: business.verificationStatus === "VERIFIED", publishedAt: business.verificationStatus === "VERIFIED" ? new Date() : null } });
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
    const store = await prisma.store.update({ where: { id: existing.id }, data: body.data });
    return reply.send({ store });
  });

  app.post("/pro/stores/:id/listings/:listingId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const parsed = z.object({ id: z.string().min(1), listingId: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const store = await prisma.store.findFirst({ where: { id: parsed.data.id, ownerId: user.id } });
    if (!store) return reply.code(404).send({ error: "store_not_found" });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, sellerId: user.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const updated = await prisma.listing.update({ where: { id: listing.id }, data: { storeId: store.id } });
    return reply.send({ listing: updated });
  });

  app.get("/public/stores/:slug", async (request, reply) => {
    const parsed = z.object({ slug: z.string().min(1).max(80) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_slug" });
    const store = await prisma.store.findFirst({
      where: { slug: parsed.data.slug, status: "ACTIVE" },
      include: {
        business: { select: { legalName: true, tradeName: true, siren: true, siret: true, verificationStatus: true } },
        listings: { where: { status: "PUBLISHED" }, select: { id: true, title: true, slug: true, priceMinor: true, currency: true, city: true, publishedAt: true }, orderBy: { publishedAt: "desc" }, take: 48 },
      },
    });
    if (!store) return reply.code(404).send({ error: "store_not_found" });
    return reply.send({ store });
  });
}
