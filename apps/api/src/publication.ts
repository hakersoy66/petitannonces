import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";

const idParams = z.object({ id: z.string().min(1) });
const consentSchema = z.object({
  termsAccepted: z.literal(true),
  rulesAccepted: z.literal(true),
  accuracyConfirmed: z.literal(true),
  professionalDisclosureConfirmed: z.literal(true),
});

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
}

function requestIpHash(request: FastifyRequest) {
  const ip = request.ip || "unknown";
  return createHash("sha256").update(`${process.env.IP_HASH_SALT ?? "petitannonces"}:${ip}`).digest("hex");
}

async function evaluateListing(listingId: string, userId: string) {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, sellerId: userId, status: "DRAFT" },
    include: {
      category: { include: { attributes: { where: { required: true } } } },
      attributes: true,
      vehicle: true,
      property: true,
      energy: true,
    },
  });
  if (!listing) return null;

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!listing.title || listing.title.trim().length < 5) errors.push("title_required");
  if (!listing.description || listing.description.trim().length < 20) errors.push("description_required");
  if (listing.priceMinor === null && !["JOB", "SERVICE"].includes(listing.category.domain)) errors.push("price_required");

  const setIds = new Set(listing.attributes.map((attribute) => attribute.attributeId));
  for (const attribute of listing.category.attributes) if (!setIds.has(attribute.id)) errors.push(`required_attribute:${attribute.key}`);

  if (listing.category.domain === "VEHICLE" && !listing.vehicle) errors.push("vehicle_details_required");
  if (listing.category.domain === "REAL_ESTATE") {
    if (!listing.property) errors.push("property_details_required");
    if (!listing.energy) errors.push("energy_performance_required");
    else if (!listing.energy.isExempt) {
      if (!listing.energy.dpeNumber) errors.push("dpe_number_required");
      if (!listing.energy.dpeDate || listing.energy.dpeDate < new Date("2021-07-01T00:00:00.000Z") || listing.energy.dpeDate > new Date()) errors.push("valid_dpe_date_required");
      if (!listing.energy.energyClass) errors.push("energy_class_required");
      if (!listing.energy.climateClass) errors.push("climate_class_required");
      if (listing.energy.annualCostMinMinor === null || listing.energy.annualCostMaxMinor === null) errors.push("annual_energy_cost_required");
      if (!listing.energy.energyPriceReferenceYears) errors.push("energy_price_reference_years_required");
      if (listing.property?.transactionType === "RENTAL" && listing.energy.energyClass === "G") warnings.push("rental_dpe_g_requires_eligibility_review");
    } else if (!listing.energy.exemptionReason) errors.push("dpe_exemption_reason_required");
  }

  const mediaRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY'`,
    listing.id,
  );
  const mediaCount = Number(mediaRows[0]?.count ?? 0n);
  if (mediaCount === 0 && !["JOB", "SERVICE"].includes(listing.category.domain)) warnings.push("no_ready_photo");

  const commerceRows = await prisma.$queryRawUnsafe<Array<{
    securePaymentEnabled: boolean;
    handDeliveryEnabled: boolean;
    mondialRelayEnabled: boolean;
    colissimoEnabled: boolean;
    packageWeightG: number | null;
    packageLengthCm: number | null;
    packageWidthCm: number | null;
    packageHeightCm: number | null;
  }>>(`SELECT * FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`, listing.id);
  const commerce = commerceRows[0] ?? null;
  const shippingSelected = Boolean(commerce?.mondialRelayEnabled || commerce?.colissimoEnabled);
  if (shippingSelected && (!commerce?.packageWeightG || !commerce.packageLengthCm || !commerce.packageWidthCm || !commerce.packageHeightCm)) errors.push("package_dimensions_required");
  if (commerce && !commerce.handDeliveryEnabled && !commerce.mondialRelayEnabled && !commerce.colissimoEnabled && !["REAL_ESTATE", "VEHICLE", "JOB", "SERVICE"].includes(listing.category.domain)) warnings.push("no_delivery_method");

  return {
    listing,
    ready: errors.length === 0,
    errors,
    warnings,
    summary: {
      title: listing.title,
      priceMinor: listing.priceMinor,
      currency: listing.currency,
      category: { name: listing.category.name, slug: listing.category.slug, domain: listing.category.domain },
      mediaCount,
      commerce,
    },
  };
}

export async function registerPublicationRoutes(app: FastifyInstance) {
  app.get("/listings/:id/publication-check", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await evaluateListing(params.data.id, user.id);
    if (!result) return reply.code(404).send({ error: "draft_not_found" });
    return reply.send({ ready: result.ready, errors: result.errors, warnings: result.warnings, summary: result.summary });
  });

  app.post("/listings/:id/publish", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = consentSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "publication_consents_required" });

    const result = await evaluateListing(params.data.id, user.id);
    if (!result) return reply.code(404).send({ error: "draft_not_found" });
    if (!result.ready) return reply.code(422).send({ ready: false, errors: result.errors, warnings: result.warnings });

    const slug = `${slugify(result.listing.title!)}-${randomBytes(4).toString("hex")}`;
    const consentId = randomUUID();
    const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 500) || null;

    const listing = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "ListingPublicationConsent" ("id","listingId","userId","termsAccepted","rulesAccepted","accuracyConfirmed","professionalDisclosureConfirmed","ipHash","userAgent","createdAt") VALUES ($1,$2,$3,TRUE,TRUE,TRUE,TRUE,$4,$5,NOW())`,
        consentId, result.listing.id, user.id, requestIpHash(request), userAgent,
      );
      return tx.listing.update({ where: { id: result.listing.id }, data: { status: "PENDING", slug } });
    });

    return reply.send({ ready: true, status: "PENDING", listing, warnings: result.warnings, moderation: { required: true } });
  });
}
