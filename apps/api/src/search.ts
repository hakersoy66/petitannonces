import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchOpenSearch } from "./opensearch.js";

const searchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(100).optional(),
  city: z.string().trim().max(120).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(300).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function registerSearchRoutes(app: FastifyInstance) {
  app.get("/search", async (request, reply) => {
    const parsed = searchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_search", details: parsed.error.flatten() });
    const p = parsed.data;
    const minPriceMinor = p.minPrice !== undefined ? Math.round(p.minPrice * 100) : undefined;
    const maxPriceMinor = p.maxPrice !== undefined ? Math.round(p.maxPrice * 100) : undefined;

    const os = await searchOpenSearch({ q: p.q, category: p.category, city: p.city, minPriceMinor, maxPriceMinor, page: p.page, limit: p.limit }).catch(() => null);
    if (os?.ids.length) {
      const records = await prisma.listing.findMany({ where: { id: { in: os.ids }, status: "PUBLISHED" }, include: { category: true, vehicle: true, property: true, energy: true } });
      const byId = new Map(records.map((record) => [record.id, record]));
      return reply.send({ engine: "opensearch", page: p.page, limit: p.limit, total: os.total, items: os.ids.map((id) => byId.get(id)).filter(Boolean) });
    }

    const where = {
      status: "PUBLISHED" as const,
      ...(p.category ? { category: { slug: p.category } } : {}),
      ...(p.city ? { city: { equals: p.city, mode: "insensitive" as const } } : {}),
      ...(p.q ? { OR: [
        { title: { contains: p.q, mode: "insensitive" as const } },
        { description: { contains: p.q, mode: "insensitive" as const } },
        { category: { name: { contains: p.q, mode: "insensitive" as const } } },
      ] } : {}),
      ...(minPriceMinor !== undefined || maxPriceMinor !== undefined ? { priceMinor: { ...(minPriceMinor !== undefined ? { gte: minPriceMinor } : {}), ...(maxPriceMinor !== undefined ? { lte: maxPriceMinor } : {}) } } : {}),
    };

    const needsGeo = p.lat !== undefined && p.lng !== undefined && p.radiusKm !== undefined;
    if (needsGeo) {
      const candidates = await prisma.listing.findMany({
        where: { ...where, latitude: { not: null }, longitude: { not: null } },
        include: { category: true, vehicle: true, property: true, energy: true },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: 500,
      });
      const filtered = candidates
        .map((item) => ({ ...item, distanceKm: haversineKm(p.lat!, p.lng!, item.latitude!, item.longitude!) }))
        .filter((item) => item.distanceKm <= p.radiusKm!)
        .sort((a, b) => a.distanceKm - b.distanceKm);
      const start = (p.page - 1) * p.limit;
      return reply.send({ engine: "postgres", page: p.page, limit: p.limit, total: filtered.length, items: filtered.slice(start, start + p.limit) });
    }

    const [items, total] = await Promise.all([
      prisma.listing.findMany({ where, include: { category: true, vehicle: true, property: true, energy: true }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], skip: (p.page - 1) * p.limit, take: p.limit }),
      prisma.listing.count({ where }),
    ]);
    return reply.send({ engine: "postgres", page: p.page, limit: p.limit, total, items });
  });

  app.get("/search/autocomplete", async (request, reply) => {
    const parsed = z.object({ q: z.string().trim().min(2).max(80) }).safeParse(request.query);
    if (!parsed.success) return reply.send({ suggestions: [] });
    const q = parsed.data.q;
    const [categories, listings, cities] = await Promise.all([
      prisma.category.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { name: true, slug: true }, take: 5 }),
      prisma.listing.findMany({ where: { status: "PUBLISHED", title: { contains: q, mode: "insensitive" } }, select: { title: true, slug: true }, take: 6 }),
      prisma.listing.findMany({ where: { status: "PUBLISHED", city: { contains: q, mode: "insensitive" } }, select: { city: true }, distinct: ["city"], take: 5 }),
    ]);
    return reply.send({ suggestions: [
      ...categories.map((item) => ({ type: "category", label: item.name, value: item.slug })),
      ...listings.filter((item) => item.title && item.slug).map((item) => ({ type: "listing", label: item.title!, value: item.slug! })),
      ...cities.filter((item) => item.city).map((item) => ({ type: "city", label: item.city!, value: item.city! })),
    ] });
  });

  app.get("/public/listings/:slug", async (request, reply) => {
    const parsed = z.object({ slug: z.string().min(1).max(220) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_slug" });
    const listing = await prisma.listing.findFirst({ where: { slug: parsed.data.slug, status: "PUBLISHED" }, include: {
      category: true, vehicle: true, property: true, energy: true,
      attributes: { include: { attribute: true } },
      seller: { select: { id: true, kind: true, createdAt: true, profile: { select: { displayName: true, avatarUrl: true } } } },
    } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    return reply.send({ listing });
  });

  app.get("/seo/category/:category/city/:city", async (request, reply) => {
    const parsed = z.object({ category: z.string().min(1), city: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_route" });
    const category = await prisma.category.findUnique({ where: { slug: parsed.data.category }, select: { name: true, slug: true } });
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    const total = await prisma.listing.count({ where: { status: "PUBLISHED", category: { slug: parsed.data.category }, city: { equals: parsed.data.city, mode: "insensitive" } } });
    return reply.send({
      title: `${category.name} à ${parsed.data.city} - Annonces | Petit Annonces`,
      description: `Découvrez ${total} annonce${total > 1 ? "s" : ""} ${category.name.toLowerCase()} à ${parsed.data.city} sur Petit Annonces.`,
      canonicalPath: `/c/${category.slug}/${encodeURIComponent(parsed.data.city.toLowerCase())}`,
      total,
    });
  });
}
