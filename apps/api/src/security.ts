import { createHash, randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
const RESET_TTL_MS = 30 * 60 * 1000;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

async function currentSession(request: FastifyRequest, reply: FastifyReply) {
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

  return session;
}

export async function registerSecurityRoutes(app: FastifyInstance) {
  app.post("/auth/password/forgot", async (request, reply) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) return reply.send({ accepted: true });

    const token = newToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      },
    });

    return reply.send({
      accepted: true,
      ...(process.env.NODE_ENV !== "production" ? { devResetToken: token } : {}),
    });
  });

  app.post("/auth/password/reset", async (request, reply) => {
    const parsed = z.object({ token: z.string().min(20), password: z.string().min(10).max(128) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(parsed.data.token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      return reply.code(400).send({ error: "invalid_or_expired_token" });
    }

    const passwordHash = await hash(parsed.data.password, {
      algorithm: 2,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await prisma.$transaction([
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }),
      prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    return reply.send({ reset: true });
  });

  app.get("/account/sessions", async (request, reply) => {
    const session = await currentSession(request, reply);
    if (!session) return;

    const sessions = await prisma.session.findMany({
      where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      orderBy: { lastSeenAt: "desc" },
    });

    return reply.send({ currentSessionId: session.id, sessions });
  });

  app.delete("/account/sessions/:sessionId", async (request, reply) => {
    const session = await currentSession(request, reply);
    if (!session) return;

    const params = z.object({ sessionId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    await prisma.session.updateMany({
      where: { id: params.data.sessionId, userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return reply.code(204).send();
  });
}
