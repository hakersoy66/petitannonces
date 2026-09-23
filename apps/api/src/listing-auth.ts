import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getBlockingSpamHold } from "./listing-content-policy.js";

const SESSION_COOKIE = "pa_session";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(request: FastifyRequest) {
  const value=request.headers.authorization;
  if(typeof value!=="string")return null;
  const match=/^Bearer\s+([A-Za-z0-9_-]{20,300})$/i.exec(value.trim());
  return match?.[1]??null;
}

export async function requireListingUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE] ?? bearerToken(request);
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

  const hold=await getBlockingSpamHold(request,session.user.id);
  if(hold){reply.code(423).send({error:"account_security_hold",reasonCode:hold.reasonCode,redirect:"/compte-suspendu"});return null}
  return session.user;
}
