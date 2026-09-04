import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyReply, FastifyRequest } from "fastify";

const SESSION_COOKIE = "pa_session";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function requireListingUser(request: FastifyRequest, reply: FastifyReply) {
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
