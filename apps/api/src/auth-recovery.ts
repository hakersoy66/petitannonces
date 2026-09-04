import { createHash, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const RESET_TTL_MS = 1000 * 60 * 30;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function newOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

async function hashPassword(password: string) {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function registerAuthRecoveryRoutes(app: FastifyInstance) {
  app.post("/auth/forgot-password", async (request, reply) => {
    const body = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    const user = await prisma.user.findUnique({ where: { email: body.data.email } });
    if (!user) return reply.send({ requested: true });

    const token = newOpaqueToken();
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    return reply.send({
      requested: true,
      ...(process.env.NODE_ENV !== "production" ? { devResetToken: token } : {}),
    });
  });

  app.post("/auth/reset-password", async (request, reply) => {
    const body = z.object({ token: z.string().min(20), password: z.string().min(10).max(128) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(body.data.token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      return reply.code(400).send({ error: "invalid_or_expired_token" });
    }

    const passwordHash = await hashPassword(body.data.password);
    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }),
      prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    return reply.send({ reset: true });
  });
}
