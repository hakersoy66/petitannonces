import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { createPresignedUpload, publicObjectUrl, storageConfigured, verifyStoredObject } from "./storage.js";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES_PER_LISTING = 20;

function extensionForMime(mimeType: string) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : mimeType === "image/avif" ? "avif" : "webp";
}

export async function registerMediaRoutes(app: FastifyInstance) {
  app.post("/listings/:id/media/upload-intent", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });

    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ mimeType: z.string().min(1), sizeBytes: z.number().int().positive(), altText: z.string().trim().max(180).nullish() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!IMAGE_MIME_TYPES.has(body.data.mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    if (body.data.sizeBytes > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_IMAGE_BYTES });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id, status: { in: ["DRAFT", "PENDING", "PUBLISHED"] } }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "listingId" = $1 AND "status" <> 'FAILED'`, listing.id);
    const count = Number(countRows[0]?.count ?? 0n);
    if (count >= MAX_IMAGES_PER_LISTING) return reply.code(409).send({ error: "media_limit_reached", limit: MAX_IMAGES_PER_LISTING });

    const mediaId = randomUUID();
    const objectKey = `listings/${listing.id}/${mediaId}.${extensionForMime(body.data.mimeType)}`;
    const sortOrder = count * 10;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ListingMedia" ("id","listingId","objectKey","mimeType","sizeBytes","status","sortOrder","isCover","altText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,NOW(),NOW())`,
      mediaId, listing.id, objectKey, body.data.mimeType, body.data.sizeBytes, sortOrder, count === 0, body.data.altText ?? null,
    );

    return reply.code(201).send({
      mediaId,
      uploadUrl: await createPresignedUpload(objectKey, body.data.mimeType),
      method: "PUT",
      headers: { "content-type": body.data.mimeType },
      expiresInSeconds: 600,
    });
  });

  app.post("/listings/:id/media/:mediaId/confirm", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });

    const params = z.object({ id: z.string().min(1), mediaId: z.string().uuid() }).safeParse(request.params);
    const body = z.object({ width: z.number().int().positive().max(30000).nullish(), height: z.number().int().positive().max(30000).nullish() }).safeParse(request.body ?? {});
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const rows = await prisma.$queryRawUnsafe<Array<{ objectKey: string; mimeType: string; sizeBytes: number }>>(
      `SELECT m."objectKey", m."mimeType", m."sizeBytes" FROM "ListingMedia" m JOIN "Listing" l ON l."id" = m."listingId" WHERE m."id" = $1 AND m."listingId" = $2 AND l."sellerId" = $3 LIMIT 1`,
      params.data.mediaId, params.data.id, user.id,
    );
    const media = rows[0];
    if (!media) return reply.code(404).send({ error: "media_not_found" });

    const stored = await verifyStoredObject(media.objectKey);
    if (!stored.sizeBytes || stored.sizeBytes > MAX_IMAGE_BYTES || stored.mimeType !== media.mimeType) {
      await prisma.$executeRawUnsafe(`UPDATE "ListingMedia" SET "status"='FAILED', "updatedAt"=NOW() WHERE "id"=$1`, params.data.mediaId);
      return reply.code(422).send({ error: "stored_media_mismatch" });
    }

    const publicUrl = publicObjectUrl(media.objectKey);
    await prisma.$executeRawUnsafe(
      `UPDATE "ListingMedia" SET "status"='READY', "publicUrl"=$2, "sizeBytes"=$3, "width"=$4, "height"=$5, "updatedAt"=NOW() WHERE "id"=$1`,
      params.data.mediaId, publicUrl, stored.sizeBytes, body.data.width ?? null, body.data.height ?? null,
    );
    return reply.send({ media: { id: params.data.mediaId, url: publicUrl, width: body.data.width ?? null, height: body.data.height ?? null } });
  });

  app.put("/listings/:id/media/order", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ mediaIds: z.array(z.string().uuid()).min(1).max(MAX_IMAGES_PER_LISTING), coverMediaId: z.string().uuid() }).safeParse(request.body);
    if (!params.success || !body.success || !body.data.mediaIds.includes(body.data.coverMediaId)) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY'`, listing.id);
    const allowed = new Set(rows.map((row) => row.id));
    if (body.data.mediaIds.some((id) => !allowed.has(id))) return reply.code(400).send({ error: "media_not_in_listing" });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE "ListingMedia" SET "isCover"=FALSE WHERE "listingId"=$1`, listing.id);
      for (const [index, id] of body.data.mediaIds.entries()) {
        await tx.$executeRawUnsafe(`UPDATE "ListingMedia" SET "sortOrder"=$2, "isCover"=$3, "updatedAt"=NOW() WHERE "id"=$1`, id, index * 10, id === body.data.coverMediaId);
      }
    });
    return reply.send({ saved: true });
  });

  app.delete("/listings/:id/media/:mediaId", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1), mediaId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const deleted = await prisma.$executeRawUnsafe(`DELETE FROM "ListingMedia" WHERE "id"=$1 AND "listingId"=$2`, params.data.mediaId, listing.id);
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: "media_not_found" });
  });
}
