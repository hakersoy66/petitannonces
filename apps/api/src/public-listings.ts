import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

function readAttributeValue(value: {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
}) {
  if (value.valueText !== null) return value.valueText;
  if (value.valueNumber !== null) return value.valueNumber;
  if (value.valueBoolean !== null) return value.valueBoolean;
  return value.valueJson;
}

export async function registerPublicListingRoutes(app: FastifyInstance) {
  app.get("/public/listings/:slug", async (request, reply) => {
    const params = z.object({ slug: z.string().min(1).max(180) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({
      where: { slug: params.data.slug, status: "PUBLISHED" },
      include: {
        category: { include: { parent: { include: { parent: true } } } },
        attributes: { include: { attribute: true } },
        vehicle: true,
        property: true,
        energy: true,
        seller: {
          select: {
            id: true,
            kind: true,
            createdAt: true,
            profile: { select: { displayName: true, firstName: true, avatarUrl: true } },
            business: { select: { tradeName: true, legalName: true, verificationStatus: true } },
            stores: { where: { status: "ACTIVE" }, take: 1, select: { name: true, slug: true, logoUrl: true, isVerified: true } },
          },
        },
      },
    });

    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const sellerName = listing.seller.stores[0]?.name
      ?? listing.seller.business?.tradeName
      ?? listing.seller.profile?.displayName
      ?? listing.seller.profile?.firstName
      ?? "Annonceur Petit Annonces";

    const attributes = listing.attributes.map((item) => ({
      key: item.attribute.key,
      label: item.attribute.label,
      unit: item.attribute.unit,
      value: readAttributeValue(item),
    }));

    const breadcrumb = [listing.category.parent?.parent, listing.category.parent, listing.category]
      .filter(Boolean)
      .map((item) => ({ name: item!.name, slug: item!.slug }));

    const media = await prisma.$queryRawUnsafe<Array<{
      id: string;
      publicUrl: string;
      mimeType: string;
      width: number | null;
      height: number | null;
      altText: string | null;
      isCover: boolean;
      sortOrder: number;
    }>>(
      `SELECT "id","publicUrl","mimeType","width","height","altText","isCover","sortOrder" FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY' AND "publicUrl" IS NOT NULL ORDER BY "isCover" DESC, "sortOrder" ASC, "createdAt" ASC`,
      listing.id,
    );

    return reply.send({
      listing: {
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        description: listing.description,
        priceMinor: listing.priceMinor,
        currency: listing.currency,
        city: listing.city,
        postalCode: listing.postalCode,
        region: listing.region,
        latitude: listing.latitude,
        longitude: listing.longitude,
        publishedAt: listing.publishedAt,
        category: { id: listing.category.id, name: listing.category.name, slug: listing.category.slug, domain: listing.category.domain },
        breadcrumb,
        attributes,
        media: media.map((item) => ({
          id: item.id,
          url: item.publicUrl,
          mimeType: item.mimeType,
          width: item.width,
          height: item.height,
          altText: item.altText,
          isCover: item.isCover,
        })),
        vehicle: listing.vehicle,
        property: listing.property,
        energy: listing.energy,
        seller: {
          id: listing.seller.id,
          kind: listing.seller.kind,
          name: sellerName,
          avatarUrl: listing.seller.profile?.avatarUrl ?? listing.seller.stores[0]?.logoUrl ?? null,
          memberSince: listing.seller.createdAt,
          verified: listing.seller.business?.verificationStatus === "VERIFIED" || listing.seller.stores[0]?.isVerified === true,
          store: listing.seller.stores[0] ?? null,
        },
      },
    });
  });
}
