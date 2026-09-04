import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
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

    const profile = await prisma.userProfile.upsert({
      where: { userId: user.id },
      update: parsed.data,
      create: { userId: user.id, ...parsed.data },
    });

    return reply.send({ profile });
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

    const address = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
      }

      return tx.address.create({ data: { userId: user.id, ...parsed.data } });
    });

    return reply.code(201).send({ address });
  });
}
