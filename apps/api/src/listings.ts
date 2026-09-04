import { randomBytes } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { lookupVehicleByPlate, normalizeFrenchPlate, plateHash } from "./vehicle-data.js";

const idParams = z.object({ id: z.string().min(1) });
const energyClass = z.enum(["A", "B", "C", "D", "E", "F", "G"]);

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);
}

async function ownedDraft(id: string, userId: string) {
  return prisma.listing.findFirst({
    where: { id, sellerId: userId, status: "DRAFT" },
    include: { category: true },
  });
}

const basicsSchema = z.object({
  title: z.string().trim().min(5).max(120).optional(),
  description: z.string().trim().min(20).max(12000).optional(),
  priceMinor: z.number().int().nonnegative().nullable().optional(),
  currency: z.literal("EUR").default("EUR"),
});

const vehicleManualSchema = z.object({
  make: z.string().trim().max(100).nullish(),
  model: z.string().trim().max(120).nullish(),
  version: z.string().trim().max(160).nullish(),
  firstRegistrationDate: z.string().date().nullish(),
  modelYear: z.number().int().min(1900).max(2100).nullish(),
  fuel: z.string().trim().max(80).nullish(),
  transmission: z.string().trim().max(80).nullish(),
  bodyType: z.string().trim().max(80).nullish(),
  powerKw: z.number().int().nonnegative().nullish(),
  fiscalPowerCv: z.number().int().nonnegative().nullish(),
  co2GKm: z.number().int().nonnegative().nullish(),
  euroStandard: z.string().trim().max(40).nullish(),
  seats: z.number().int().positive().max(100).nullish(),
  doors: z.number().int().positive().max(20).nullish(),
  color: z.string().trim().max(80).nullish(),
  mileageKm: z.number().int().nonnegative().max(5000000).nullish(),
});

const propertyEnergySchema = z.object({
  property: z.object({
    transactionType: z.enum(["SALE", "RENTAL"]),
    propertyType: z.string().trim().min(2).max(80),
    surfaceM2: z.number().positive().max(100000),
    rooms: z.number().int().positive().max(1000).nullish(),
    bedrooms: z.number().int().nonnegative().max(1000).nullish(),
    furnished: z.boolean().default(false),
    floor: z.number().int().min(-10).max(300).nullish(),
    totalFloors: z.number().int().positive().max(300).nullish(),
    landM2: z.number().nonnegative().max(10000000).nullish(),
    postalCode: z.string().trim().max(12).nullish(),
    city: z.string().trim().max(120).nullish(),
    countryCode: z.string().trim().length(2).default("FR"),
  }),
  energy: z.discriminatedUnion("isExempt", [
    z.object({
      isExempt: z.literal(true),
      exemptionReason: z.string().trim().min(5).max(300),
    }),
    z.object({
      isExempt: z.literal(false),
      dpeNumber: z.string().trim().min(8).max(40),
      dpeDate: z.string().date(),
      energyClass,
      climateClass: energyClass,
      energyConsumptionKwhM2Year: z.number().nonnegative().max(10000),
      ghgKgCo2M2Year: z.number().nonnegative().max(10000),
      annualCostMinMinor: z.number().int().nonnegative(),
      annualCostMaxMinor: z.number().int().nonnegative(),
      energyPriceReferenceYears: z.string().trim().min(4).max(80),
    }),
  ]),
});

export async function registerListingRoutes(app: FastifyInstance) {
  app.get("/categories/tree", async () => {
    const categories = await prisma.category.findMany({
      where: { parentId: null },
      include: {
        children: {
          include: { children: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });
    return { categories };
  });

  app.get("/categories/:slug/attributes", async (request, reply) => {
    const params = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const category = await prisma.category.findUnique({
      where: { slug: params.data.slug },
      include: { attributes: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } } },
    });
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    return reply.send({ category });
  });

  app.post("/listings/drafts", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;

    const parsed = z.object({ categoryId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
    if (!category) return reply.code(404).send({ error: "category_not_found" });

    const listing = await prisma.listing.create({
      data: { sellerId: user.id, categoryId: category.id, status: "DRAFT" },
      include: { category: true },
    });
    return reply.code(201).send({ listing });
  });

  app.patch("/listings/:id/basics", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = basicsSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const draft = await ownedDraft(params.data.id, user.id);
    if (!draft) return reply.code(404).send({ error: "draft_not_found" });

    const listing = await prisma.listing.update({ where: { id: draft.id }, data: body.data });
    return reply.send({ listing });
  });

  app.put("/listings/:id/attributes", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({ values: z.array(z.object({ attributeId: z.string().min(1), value: z.unknown() })).max(100) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const draft = await ownedDraft(params.data.id, user.id);
    if (!draft) return reply.code(404).send({ error: "draft_not_found" });

    const definitions = await prisma.categoryAttribute.findMany({
      where: { categoryId: draft.categoryId, id: { in: body.data.values.map((item) => item.attributeId) } },
      include: { options: true },
    });
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    if (definitions.length !== body.data.values.length) return reply.code(400).send({ error: "attribute_not_in_category" });

    await prisma.$transaction(async (tx) => {
      for (const item of body.data.values) {
        const definition = byId.get(item.attributeId)!;
        const data: { valueText?: string | null; valueNumber?: number | null; valueBoolean?: boolean | null; valueJson?: object | string[] | null } = {
          valueText: null,
          valueNumber: null,
          valueBoolean: null,
          valueJson: null,
        };

        if (definition.type === "NUMBER") {
          if (typeof item.value !== "number" || !Number.isFinite(item.value)) throw new Error("invalid_number_attribute");
          data.valueNumber = item.value;
        } else if (definition.type === "BOOLEAN") {
          if (typeof item.value !== "boolean") throw new Error("invalid_boolean_attribute");
          data.valueBoolean = item.value;
        } else if (definition.type === "MULTISELECT") {
          if (!Array.isArray(item.value) || !item.value.every((entry) => typeof entry === "string")) throw new Error("invalid_multiselect_attribute");
          const allowed = new Set(definition.options.map((option) => option.value));
          if (item.value.some((entry) => !allowed.has(entry))) throw new Error("invalid_attribute_option");
          data.valueJson = item.value;
        } else {
          if (typeof item.value !== "string") throw new Error("invalid_text_attribute");
          if (definition.type === "SELECT" && !definition.options.some((option) => option.value === item.value)) throw new Error("invalid_attribute_option");
          data.valueText = item.value.trim().slice(0, 1000);
        }

        await tx.listingAttributeValue.upsert({
          where: { listingId_attributeId: { listingId: draft.id, attributeId: definition.id } },
          create: { listingId: draft.id, attributeId: definition.id, ...data },
          update: data,
        });
      }
    });

    return reply.send({ saved: true });
  });

  app.post("/listings/:id/vehicle/from-plate", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({ registrationPlate: z.string().trim().min(5).max(20) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const draft = await ownedDraft(params.data.id, user.id);
    if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    if (draft.category.domain !== "VEHICLE") return reply.code(400).send({ error: "vehicle_category_required" });

    try {
      const normalized = normalizeFrenchPlate(body.data.registrationPlate);
      const vehicle = await lookupVehicleByPlate(normalized);
      const saved = await prisma.vehicleDetails.upsert({
        where: { listingId: draft.id },
        create: {
          listingId: draft.id,
          registrationPlateHash: plateHash(normalized),
          registrationPlateLast4: normalized.replace(/-/g, "").slice(-4),
          dataSource: vehicle.source,
          dataVerifiedAt: new Date(),
          make: vehicle.make ?? null,
          model: vehicle.model ?? null,
          version: vehicle.version ?? null,
          firstRegistrationDate: vehicle.firstRegistrationDate ? new Date(vehicle.firstRegistrationDate) : null,
          modelYear: vehicle.modelYear ?? null,
          fuel: vehicle.fuel ?? null,
          transmission: vehicle.transmission ?? null,
          bodyType: vehicle.bodyType ?? null,
          powerKw: vehicle.powerKw ?? null,
          fiscalPowerCv: vehicle.fiscalPowerCv ?? null,
          co2GKm: vehicle.co2GKm ?? null,
          euroStandard: vehicle.euroStandard ?? null,
          seats: vehicle.seats ?? null,
          doors: vehicle.doors ?? null,
          color: vehicle.color ?? null,
        },
        update: {
          registrationPlateHash: plateHash(normalized),
          registrationPlateLast4: normalized.replace(/-/g, "").slice(-4),
          dataSource: vehicle.source,
          dataVerifiedAt: new Date(),
          make: vehicle.make ?? null,
          model: vehicle.model ?? null,
          version: vehicle.version ?? null,
          firstRegistrationDate: vehicle.firstRegistrationDate ? new Date(vehicle.firstRegistrationDate) : null,
          modelYear: vehicle.modelYear ?? null,
          fuel: vehicle.fuel ?? null,
          transmission: vehicle.transmission ?? null,
          bodyType: vehicle.bodyType ?? null,
          powerKw: vehicle.powerKw ?? null,
          fiscalPowerCv: vehicle.fiscalPowerCv ?? null,
          co2GKm: vehicle.co2GKm ?? null,
          euroStandard: vehicle.euroStandard ?? null,
          seats: vehicle.seats ?? null,
          doors: vehicle.doors ?? null,
          color: vehicle.color ?? null,
        },
      });
      return reply.send({ vehicle: saved, plateStored: false });
    } catch (error) {
      const code = error instanceof Error ? error.message : "vehicle_lookup_failed";
      const status = code === "invalid_registration_plate" ? 400 : code === "vehicle_not_found" ? 404 : code === "vehicle_data_provider_not_configured" ? 503 : 502;
      return reply.code(status).send({ error: code });
    }
  });

  app.put("/listings/:id/vehicle", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = vehicleManualSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const draft = await ownedDraft(params.data.id, user.id);
    if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    if (draft.category.domain !== "VEHICLE") return reply.code(400).send({ error: "vehicle_category_required" });

    const data = {
      ...body.data,
      firstRegistrationDate: body.data.firstRegistrationDate ? new Date(body.data.firstRegistrationDate) : null,
    };
    const vehicle = await prisma.vehicleDetails.upsert({
      where: { listingId: draft.id },
      create: { listingId: draft.id, ...data },
      update: data,
    });
    return reply.send({ vehicle });
  });

  app.put("/listings/:id/property-energy", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = propertyEnergySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request", details: body.success ? undefined : body.error.flatten() });

    const draft = await ownedDraft(params.data.id, user.id);
    if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    if (draft.category.domain !== "REAL_ESTATE") return reply.code(400).send({ error: "real_estate_category_required" });

    const { property, energy } = body.data;
    if (!energy.isExempt && energy.annualCostMaxMinor < energy.annualCostMinMinor) {
      return reply.code(400).send({ error: "invalid_energy_cost_range" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const savedProperty = await tx.propertyDetails.upsert({
        where: { listingId: draft.id },
        create: { listingId: draft.id, ...property },
        update: property,
      });

      const energyData = energy.isExempt
        ? {
            isExempt: true,
            exemptionReason: energy.exemptionReason,
            dpeNumber: null,
            dpeDate: null,
            validUntil: null,
            energyClass: null,
            climateClass: null,
            energyConsumptionKwhM2Year: null,
            ghgKgCo2M2Year: null,
            annualCostMinMinor: null,
            annualCostMaxMinor: null,
            energyPriceReferenceYears: null,
            excessiveConsumption: false,
          }
        : {
            isExempt: false,
            exemptionReason: null,
            dpeNumber: energy.dpeNumber,
            dpeDate: new Date(energy.dpeDate),
            validUntil: new Date(new Date(energy.dpeDate).setFullYear(new Date(energy.dpeDate).getFullYear() + 10)),
            energyClass: energy.energyClass,
            climateClass: energy.climateClass,
            energyConsumptionKwhM2Year: energy.energyConsumptionKwhM2Year,
            ghgKgCo2M2Year: energy.ghgKgCo2M2Year,
            annualCostMinMinor: energy.annualCostMinMinor,
            annualCostMaxMinor: energy.annualCostMaxMinor,
            energyPriceReferenceYears: energy.energyPriceReferenceYears,
            excessiveConsumption: energy.energyClass === "F" || energy.energyClass === "G",
          };

      const savedEnergy = await tx.propertyEnergyPerformance.upsert({
        where: { listingId: draft.id },
        create: { listingId: draft.id, ...energyData },
        update: energyData,
      });
      return { property: savedProperty, energy: savedEnergy };
    });

    return reply.send(result);
  });

  app.post("/listings/:id/submit", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, sellerId: user.id, status: "DRAFT" },
      include: {
        category: { include: { attributes: { where: { required: true } } } },
        attributes: true,
        vehicle: true,
        property: true,
        energy: true,
      },
    });
    if (!listing) return reply.code(404).send({ error: "draft_not_found" });

    const errors: string[] = [];
    const warnings: string[] = [];
    if (!listing.title || listing.title.trim().length < 5) errors.push("title_required");
    if (!listing.description || listing.description.trim().length < 20) errors.push("description_required");

    const setAttributeIds = new Set(listing.attributes.map((attribute) => attribute.attributeId));
    for (const attribute of listing.category.attributes) {
      if (!setAttributeIds.has(attribute.id)) errors.push(`required_attribute:${attribute.key}`);
    }

    if (listing.category.domain === "VEHICLE" && !listing.vehicle) errors.push("vehicle_details_required");

    if (listing.category.domain === "REAL_ESTATE") {
      if (!listing.property) errors.push("property_details_required");
      if (!listing.energy) {
        errors.push("energy_performance_required");
      } else if (!listing.energy.isExempt) {
        if (!listing.energy.dpeNumber) errors.push("dpe_number_required");
        if (!listing.energy.dpeDate || listing.energy.dpeDate < new Date("2021-07-01T00:00:00.000Z") || listing.energy.dpeDate > new Date()) errors.push("valid_dpe_date_required");
        if (!listing.energy.energyClass) errors.push("energy_class_required");
        if (!listing.energy.climateClass) errors.push("climate_class_required");
        if (listing.energy.annualCostMinMinor === null || listing.energy.annualCostMaxMinor === null) errors.push("annual_energy_cost_required");
        if (!listing.energy.energyPriceReferenceYears) errors.push("energy_price_reference_years_required");
        if (listing.property?.transactionType === "RENTAL" && listing.energy.energyClass === "G") warnings.push("rental_dpe_g_requires_eligibility_review");
      } else if (!listing.energy.exemptionReason) {
        errors.push("dpe_exemption_reason_required");
      }
    }

    if (errors.length) return reply.code(422).send({ ready: false, errors, warnings });

    const baseSlug = slugify(listing.title!);
    const slug = `${baseSlug}-${randomBytes(4).toString("hex")}`;
    const submitted = await prisma.listing.update({
      where: { id: listing.id },
      data: { status: "PENDING", slug },
    });
    return reply.send({ ready: true, listing: submitted, warnings });
  });
}
