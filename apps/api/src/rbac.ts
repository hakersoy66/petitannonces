import { prisma } from "@pa/database";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";

const SESSION_COOKIE = "pa_session";

type AdminRoleName = "SUPER_ADMIN" | "ADMIN" | "MODERATOR" | "SUPPORT" | "FINANCE" | "COMPLIANCE" | "MARKETING";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function requireAdminRoles(allowed: AdminRoleName[]) {
  return async function adminRoleGuard(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return reply.code(401).send({ error: "unauthenticated" });

    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: { roles: true } } },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
      return reply.code(401).send({ error: "unauthenticated" });
    }

    const granted = session.user.roles.some((entry: { role: string }) => allowed.includes(entry.role as AdminRoleName));
    if (!granted) return reply.code(403).send({ error: "forbidden" });
  };
}
