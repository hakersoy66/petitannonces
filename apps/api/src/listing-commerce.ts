import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";

const paramsSchema = z.object({ id: z.string().min(1) });

const settingsSchema = z.object({
  priceMinor: z.number().int().nonnegative().max(100_000_000),
  acceptsOffers: z.boolean(),
  securePaymentEnabled: z.boolean(),
  handDeliveryEnabled: z.boolean(),
  mondialRelayEnabled: z.boolean(),
  colissimoEnabled: z.boolean(),
  packageWeightG: z.number().int().positive().max(30_000).nullish(),
  packageLengthCm: z.number().int().positive().max(200).nullish(),
  packageWidthCm: z.number().int().positive().max(200).nullish(),
  packageHeightCm: z.number().int().positive().max(200).nullish(),
});

type CommerceRow = {
  listingId: string;
  acceptsOffers: boolean;
  securePaymentEnabled: boolean;
  handDeliveryEnabled: boolean;
  mondialRelayEnabled: boolean;
  colissimoEnabled: boolean;
  packageWeightG: number | null;
  packageLengthCm: number | null;
  packageWidthCm: number | null;
  packageHeightCm: number | null;
};

export async function registerListingCommerceRoutes(app: FastifyInstance) {
  app.get("/listings/:id/commerce-settings", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, sellerId: user.id },
      select: { id: true, priceMinor: true, currency: true, category: { select: { domain: true } } },
    });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const rows = await prisma.$queryRawUnsafe<CommerceRow[]>(
      `SELECT * FROM "ListingCommerceSettings" WHERE "listingId"=$1 LIMIT 1`,
      listing.id,
    );
    const settings = rows[0] ?? {
      listingId: listing.id,
      acceptsOffers: true,
      securePaymentEnabled: true,
      handDeliveryEnabled: true,
      mondialRelayEnabled: false,
      colissimoEnabled: false,
      packageWeightG: null,
      packageLengthCm: null,
      packageWidthCm: null,
      packageHeightCm: null,
    };

    return reply.send({ listing: { priceMinor: listing.priceMinor, currency: listing.currency, domain: listing.category.domain }, settings });
  });

  app.put("/listings/:id/commerce-settings", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const body = settingsSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request", details: body.success ? undefined : body.error.flatten() });

    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, sellerId: user.id, status: { in: ["DRAFT", "PENDING", "PUBLISHED"] } },
      select: { id: true, category: { select: { domain: true } } },
    });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const isShippable = !["VEHICLE", "REAL_ESTATE", "JOB", "SERVICE"].includes(listing.category.domain);
    if (!isShippable && (body.data.mondialRelayEnabled || body.data.colissimoEnabled)) {
      return reply.code(400).send({ error: "shipping_not_supported_for_category" });
    }
    if (isShippable && (body.data.mondialRelayEnabled || body.data.colissimoEnabled)) {
      const packageFields = [body.data.packageWeightG, body.data.packageLengthCm, body.data.packageWidthCm, body.data.packageHeightCm];
      if (packageFields.some((value) => value == null)) return reply.code(400).send({ error: "package_dimensions_required" });
    }
    if (!body.data.handDeliveryEnabled && !body.data.mondialRelayEnabled && !body.data.colissimoEnabled && body.data.securePaymentEnabled) {
      return reply.code(400).send({ error: "fulfillment_method_required" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id: listing.id }, data: { priceMinor: body.data.priceMinor, currency: "EUR" } });
      await tx.$executeRawUnsafe(
        `INSERT INTO "ListingCommerceSettings" (
          "listingId","acceptsOffers","securePaymentEnabled","handDeliveryEnabled","mondialRelayEnabled","colissimoEnabled",
          "packageWeightG","packageLengthCm","packageWidthCm","packageHeightCm","createdAt","updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT ("listingId") DO UPDATE SET
          "acceptsOffers"=EXCLUDED."acceptsOffers",
          "securePaymentEnabled"=EXCLUDED."securePaymentEnabled",
          "handDeliveryEnabled"=EXCLUDED."handDeliveryEnabled",
          "mondialRelayEnabled"=EXCLUDED."mondialRelayEnabled",
          "colissimoEnabled"=EXCLUDED."colissimoEnabled",
          "packageWeightG"=EXCLUDED."packageWeightG",
          "packageLengthCm"=EXCLUDED."packageLengthCm",
          "packageWidthCm"=EXCLUDED."packageWidthCm",
          "packageHeightCm"=EXCLUDED."packageHeightCm",
          "updatedAt"=NOW()`,
        listing.id,
        body.data.acceptsOffers,
        body.data.securePaymentEnabled,
        body.data.handDeliveryEnabled,
        isShippable ? body.data.mondialRelayEnabled : false,
        isShippable ? body.data.colissimoEnabled : false,
        isShippable ? body.data.packageWeightG ?? null : null,
        isShippable ? body.data.packageLengthCm ?? null : null,
        isShippable ? body.data.packageWidthCm ?? null : null,
        isShippable ? body.data.packageHeightCm ?? null : null,
      );
    });

    return reply.send({ saved: true });
  });
}
