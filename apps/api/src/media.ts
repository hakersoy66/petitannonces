import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { createPresignedUpload, deleteStoredObject, makeStoredObjectPublic, publicObjectUrl, storageConfigured, uploadStoredObject, verifyStoredObject } from "./storage.js";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES_PER_LISTING = 20;
const execFileAsync = promisify(execFile);

async function decodeHeicToJpeg(input: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "pa-heic-"));
  const source = join(dir, "source.heic");
  const output = join(dir, "decoded.jpg");
  try {
    await writeFile(source, input);
    await execFileAsync("/usr/bin/heif-convert", ["-q", "90", source, output], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function normalizeListingImage(input: Buffer, mimeType: string) {
  let decodable = input;
  if (HEIC_MIME_TYPES.has(mimeType)) decodable = await decodeHeicToJpeg(input);
  try {
    const body = await sharp(decodable, { failOn: "none", limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer();
    if (!body.length) throw new Error("empty_normalized_image");
    return { body, mimeType: "image/webp" };
  } catch (error) {
    if (HEIC_MIME_TYPES.has(mimeType)) throw error;
    return { body: input, mimeType };
  }
}

function extensionForMime(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "webp";
}

export async function registerMediaRoutes(app: FastifyInstance) {
  for (const mime of IMAGE_MIME_TYPES) {
    if (!app.hasContentTypeParser(mime)) app.addContentTypeParser(mime, { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES }, (_request, body, done) => done(null, body));
  }

  app.get("/listings/:id/media", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const media = await prisma.$queryRawUnsafe<Array<{
      id: string; publicUrl: string | null; mimeType: string; sizeBytes: number; width: number | null; height: number | null;
      sortOrder: number; isCover: boolean; status: string; altText: string | null;
    }>>(
      `SELECT "id","publicUrl","mimeType","sizeBytes","width","height","sortOrder","isCover","status","altText"
       FROM "ListingMedia" WHERE "listingId"=$1 AND "status" <> 'FAILED' ORDER BY "sortOrder" ASC, "createdAt" ASC`,
      listing.id,
    );
    return reply.send({ media });
  });

  app.post("/listings/:id/media/upload-direct", { bodyLimit: MAX_IMAGE_BYTES }, async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });

    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const mimeType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length < 1) return reply.code(400).send({ error: "empty_media" });
    if (body.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_IMAGE_BYTES });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id, status: { in: ["DRAFT", "PENDING", "PUBLISHED"] } }, select: { id: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "listingId" = $1 AND "status" <> 'FAILED'`, listing.id);
    const count = Number(countRows[0]?.count ?? 0n);
    if (count >= MAX_IMAGES_PER_LISTING) return reply.code(409).send({ error: "media_limit_reached", limit: MAX_IMAGES_PER_LISTING });

    let normalized: { body: Buffer; mimeType: string };
    try {
      normalized = await normalizeListingImage(Buffer.from(body), mimeType);
    } catch (error) {
      request.log.warn({ error, listingId: listing.id, mimeType }, "listing image normalization failed");
      return reply.code(422).send({ error: HEIC_MIME_TYPES.has(mimeType) ? "heic_conversion_failed" : "image_processing_failed" });
    }
    if (normalized.body.length > MAX_IMAGE_BYTES) return reply.code(413).send({ error: "media_too_large", maxBytes: MAX_IMAGE_BYTES });

    const mediaId = randomUUID();
    const objectKey = `listings/${listing.id}/${mediaId}.${extensionForMime(normalized.mimeType)}`;
    const sortOrder = count * 10;
    const altTextHeader = request.headers["x-file-name"];
    const altText = typeof altTextHeader === "string" ? decodeURIComponent(altTextHeader).slice(0, 180) : null;
    const publicUrl = await uploadStoredObject(objectKey, normalized.mimeType, normalized.body);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ListingMedia" ("id","listingId","objectKey","publicUrl","mimeType","sizeBytes","status","sortOrder","isCover","altText","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,'READY',$7,$8,$9,NOW(),NOW())`,
      mediaId, listing.id, objectKey, publicUrl, normalized.mimeType, normalized.body.length, sortOrder, count === 0, altText,
    );
    return reply.code(201).send({ media: { id: mediaId, url: publicUrl, width: null, height: null } });
  });

  app.post("/listings/:id/media/upload-intent", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });

    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ mimeType: z.string().min(1), sizeBytes: z.number().int().positive(), altText: z.string().trim().max(180).nullish() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    if (!IMAGE_MIME_TYPES.has(body.data.mimeType)) return reply.code(415).send({ error: "unsupported_media_type" });
    if (HEIC_MIME_TYPES.has(body.data.mimeType)) return reply.code(409).send({ error: "heic_requires_direct_upload" });
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

    await makeStoredObjectPublic(media.objectKey);
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
    const rows = await prisma.$queryRawUnsafe<Array<{ objectKey:string }>>(`SELECT "objectKey" FROM "ListingMedia" WHERE "id"=$1 AND "listingId"=$2 LIMIT 1`, params.data.mediaId, listing.id);
    const media = rows[0];
    if (!media) return reply.code(404).send({ error: "media_not_found" });
    await prisma.$executeRawUnsafe(`DELETE FROM "ListingMedia" WHERE "id"=$1 AND "listingId"=$2`, params.data.mediaId, listing.id);
    const refs=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "objectKey"=$1`,media.objectKey).catch(()=>[]);
    if(Number(refs[0]?.count??0n)===0)await deleteStoredObject(media.objectKey).catch(()=>{});
    return reply.code(204).send();
  });
}
