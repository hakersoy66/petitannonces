import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";

const savedSearchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  query: z.string().trim().max(160).optional().nullable(),
  categorySlug: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(16).optional().nullable(),
  minPriceMinor: z.number().int().nonnegative().optional().nullable(),
  maxPriceMinor: z.number().int().nonnegative().optional().nullable(),
  filters: z.record(z.string(), z.unknown()).optional().nullable(),
  alertEnabled: z.boolean().default(true),
  frequency: z.enum(["INSTANT","DAILY","WEEKLY"]).default("DAILY"),
});

export async function registerAccountEngagementRoutes(app: FastifyInstance) {
  app.get("/account/favorites", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT f."id",f."createdAt",l."id" AS "listingId",l."title",l."slug",l."priceMinor",l."currency",l."city",c."name" AS "categoryName",
      (SELECT lm."publicUrl" FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY' ORDER BY lm."isCover" DESC,lm."sortOrder" ASC LIMIT 1) AS "imageUrl"
      FROM "FavoriteListing" f JOIN "Listing" l ON l."id"=f."listingId" JOIN "Category" c ON c."id"=l."categoryId"
      WHERE f."userId"=$1 AND l."status"='PUBLISHED' ORDER BY f."createdAt" DESC`, user.id);
    return reply.send({ favorites: rows });
  });

  app.post("/account/favorites/:listingId", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = z.object({ listingId: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, status: "PUBLISHED" }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    await prisma.$executeRawUnsafe(`INSERT INTO "FavoriteListing" ("id","userId","listingId") VALUES ($1,$2,$3) ON CONFLICT ("userId","listingId") DO NOTHING`, randomUUID(), user.id, listing.id);
    return reply.code(201).send({ favorite: true });
  });

  app.delete("/account/favorites/:listingId", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = z.object({ listingId: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    await prisma.$executeRawUnsafe(`DELETE FROM "FavoriteListing" WHERE "userId"=$1 AND "listingId"=$2`, user.id, parsed.data.listingId);
    return reply.code(204).send();
  });

  app.get("/account/saved-searches", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "SavedSearch" WHERE "userId"=$1 ORDER BY "createdAt" DESC`, user.id);
    return reply.send({ searches: rows });
  });

  app.post("/account/saved-searches", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = savedSearchSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "invalid_search", details: parsed.error.flatten() });
    const d = parsed.data; const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "SavedSearch" ("id","userId","name","query","categorySlug","city","postalCode","minPriceMinor","maxPriceMinor","filters","alertEnabled","frequency") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`, id,user.id,d.name,d.query??null,d.categorySlug??null,d.city??null,d.postalCode??null,d.minPriceMinor??null,d.maxPriceMinor??null,JSON.stringify(d.filters??{}),d.alertEnabled,d.frequency);
    return reply.code(201).send({ id });
  });

  app.put("/account/saved-searches/:id", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params); const body = savedSearchSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" }); const d=body.data;
    const count = await prisma.$executeRawUnsafe(`UPDATE "SavedSearch" SET "name"=$1,"query"=$2,"categorySlug"=$3,"city"=$4,"postalCode"=$5,"minPriceMinor"=$6,"maxPriceMinor"=$7,"filters"=$8::jsonb,"alertEnabled"=$9,"frequency"=$10,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$11 AND "userId"=$12`,d.name,d.query??null,d.categorySlug??null,d.city??null,d.postalCode??null,d.minPriceMinor??null,d.maxPriceMinor??null,JSON.stringify(d.filters??{}),d.alertEnabled,d.frequency,params.data.id,user.id);
    if (!count) return reply.code(404).send({ error: "saved_search_not_found" }); return reply.send({ updated: true });
  });

  app.delete("/account/saved-searches/:id", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(`DELETE FROM "SavedSearch" WHERE "id"=$1 AND "userId"=$2`, parsed.data.id,user.id); return reply.code(204).send();
  });

  app.get("/account/notifications", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","kind","title","body","actionUrl","metadata","readAt","createdAt" FROM "UserNotification" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 100`,user.id);
    const unread = rows.filter((r)=>!r.readAt).length; return reply.send({ notifications: rows, unread });
  });

  app.post("/account/notifications/:id/read", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed=z.object({id:z.string().min(1)}).safeParse(request.params); if(!parsed.success)return reply.code(400).send({error:"invalid_request"});
    await prisma.$executeRawUnsafe(`UPDATE "UserNotification" SET "readAt"=COALESCE("readAt",CURRENT_TIMESTAMP) WHERE "id"=$1 AND "userId"=$2`,parsed.data.id,user.id); return reply.send({read:true});
  });

  app.post("/account/notifications/read-all", async (request, reply) => {
    const user=await requireListingUser(request,reply); if(!user)return;
    await prisma.$executeRawUnsafe(`UPDATE "UserNotification" SET "readAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "readAt" IS NULL`,user.id); return reply.send({read:true});
  });
}
