import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";

const statusSchema = z.enum(["DRAFT", "PENDING", "PUBLISHED", "SUSPENDED", "SOLD", "EXPIRED"]);
const idParams = z.object({ id: z.string().min(1) });

const transitions: Record<string, string[]> = {
  DRAFT: [],
  PENDING: [],
  PUBLISHED: ["SUSPENDED", "SOLD"],
  SUSPENDED: ["PENDING"],
  SOLD: [],
  EXPIRED: ["PENDING"],
};

export async function registerAccountListingRoutes(app: FastifyInstance) {
  app.get("/account/listings", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;

    const query = z.object({ status: statusSchema.optional(), q: z.string().trim().max(100).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });

    const listings = await prisma.listing.findMany({
      where: {
        sellerId: user.id,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.q ? { title: { contains: query.data.q, mode: "insensitive" } } : {}),
      },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        priceMinor: true,
        currency: true,
        city: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        category: { select: { name: true, slug: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return reply.send({ listings });
  });

  app.post("/account/listings/:id/status", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({ status: statusSchema }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    if (!transitions[listing.status]?.includes(body.data.status)) return reply.code(409).send({ error: "invalid_status_transition", from: listing.status, to: body.data.status });

    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: body.data.status,
        ...(body.data.status === "PENDING" ? { slug: null } : {}),
      },
      select: { id: true, status: true, slug: true, updatedAt: true },
    });
    return reply.send({ listing: updated });
  });

  app.delete("/account/listings/:id", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    if (listing.status !== "DRAFT") return reply.code(409).send({ error: "only_draft_can_be_deleted" });

    await prisma.listing.delete({ where: { id: listing.id } });
    return reply.code(204).send();
  });
}
