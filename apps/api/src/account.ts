import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { storageConfigured, uploadStoredObject } from "./storage.js";

const SESSION_COOKIE = "pa_session";
const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function avatarExtension(mimeType:string){if(mimeType==="image/jpeg")return "jpg";if(mimeType==="image/png")return "png";if(mimeType==="image/avif")return "avif";return "webp";}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const authHeader=typeof request.headers.authorization==="string"?request.headers.authorization.trim():"";
  const bearer=/^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim()||null;
  const token = bearer ?? request.cookies[SESSION_COOKIE];
  if (!token) {
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }

  return session.user;
}

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80).nullable().optional(),
  firstName: z.string().trim().min(1).max(80).nullable().optional(),
  lastName: z.string().trim().min(1).max(80).nullable().optional(),
  phone: z.string().trim().min(6).max(30).nullable().optional(),
  locale: z.string().trim().min(2).max(20).optional(),
});

const addressSchema = z.object({
  type: z.enum(["HOME", "BILLING", "SHIPPING", "BUSINESS"]).default("HOME"),
  label: z.string().trim().max(80).optional(),
  recipient: z.string().trim().max(120).optional(),
  line1: z.string().trim().min(2).max(160),
  line2: z.string().trim().max(160).optional(),
  postalCode: z.string().trim().min(3).max(12),
  city: z.string().trim().min(2).max(120),
  region: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().length(2).default("FR"),
  isDefault: z.boolean().default(false),
});

export async function registerAccountRoutes(app: FastifyInstance) {
  app.patch("/account/profile", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

    const currentPhoneRows = parsed.data.phone !== undefined
      ? await prisma.$queryRawUnsafe<Array<{ phone: string | null }>>(`SELECT "phone" FROM "UserProfile" WHERE "userId"=$1 LIMIT 1`, user.id)
      : [];
    const previousPhone = currentPhoneRows[0]?.phone ?? null;
    const nextPhone = parsed.data.phone ?? null;
    const phoneChanged = parsed.data.phone !== undefined && previousPhone !== nextPhone;

    const profile = await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: parsed.data,
      create: { userId: user.id, ...parsed.data },
    });
    if (phoneChanged) {
      await prisma.$executeRawUnsafe(`UPDATE "UserProfile" SET "phoneVerifiedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1`, user.id);
    }

    return reply.send({ profile, phoneVerificationReset: phoneChanged });
  });

  app.post("/account/profile/avatar", { bodyLimit: MAX_AVATAR_BYTES }, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!storageConfigured()) return reply.code(503).send({ error: "object_storage_not_configured" });
    const mimeType = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (!mimeType || !AVATAR_MIME_TYPES.has(mimeType)) return reply.code(415).send({ error: "unsupported_avatar_type" });
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length < 1) return reply.code(400).send({ error: "empty_avatar" });
    if (body.length > MAX_AVATAR_BYTES) return reply.code(413).send({ error: "avatar_too_large", maxBytes: MAX_AVATAR_BYTES });
    const objectKey = `profiles/${user.id}/avatar-${randomUUID()}.${avatarExtension(mimeType)}`;
    const avatarUrl = await uploadStoredObject(objectKey, mimeType, body);
    const profile = await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: { avatarUrl },
      create: { userId: user.id, avatarUrl },
    });
    return reply.send({ avatarUrl: profile.avatarUrl });
  });

  app.get("/account/addresses", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const addresses = await prisma.address.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return reply.send({ addresses });
  });

  app.post("/account/addresses", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;

    const parsed = addressSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });

    const existingCount = await prisma.address.count({ where: { userId: user.id } });
    const address = await prisma.$transaction(async (tx: any) => {
      const makeDefault = parsed.data.isDefault || existingCount === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
      return tx.address.create({ data: { userId: user.id, ...parsed.data, isDefault: makeDefault } });
    });

    return reply.code(201).send({ address });
  });

  app.patch("/account/addresses/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = addressSchema.partial().safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const current = await prisma.address.findFirst({ where: { id: params.data.id, userId: user.id } });
    if (!current) return reply.code(404).send({ error: "address_not_found" });
    const address = await prisma.$transaction(async (tx: any) => {
      if (body.data.isDefault === true) await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
      return tx.address.update({ where: { id: current.id }, data: body.data });
    });
    return reply.send({ address });
  });

  app.post("/account/addresses/:id/default", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const current = await prisma.address.findFirst({ where: { id: params.data.id, userId: user.id } });
    if (!current) return reply.code(404).send({ error: "address_not_found" });
    const address = await prisma.$transaction(async (tx: any) => {
      await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
      return tx.address.update({ where: { id: current.id }, data: { isDefault: true } });
    });
    return reply.send({ address });
  });

  app.delete("/account/addresses/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const current = await prisma.address.findFirst({ where: { id: params.data.id, userId: user.id } });
    if (!current) return reply.code(404).send({ error: "address_not_found" });
    await prisma.$transaction(async (tx: any) => {
      await tx.address.delete({ where: { id: current.id } });
      if (current.isDefault) {
        const next = await tx.address.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    return reply.code(204).send();
  });
}
