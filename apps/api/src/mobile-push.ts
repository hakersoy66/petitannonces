import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthorized" }); return null;
  }
  return session.user;
}

export async function registerMobilePushRoutes(app: FastifyInstance) {
  app.post("/notifications/push/subscribe", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({
      platform: z.enum(["WEB","IOS","ANDROID"]),
      endpoint: z.string().url().optional(),
      keys: z.object({ p256dh: z.string().min(8), auth: z.string().min(4) }).optional(),
      nativeToken: z.string().min(16).max(4096).optional(),
      deviceLabel: z.string().max(120).optional(),
    }).superRefine((value, ctx) => {
      if (value.platform === "WEB" && (!value.endpoint || !value.keys)) ctx.addIssue({ code: "custom", message: "web_subscription_required" });
      if (value.platform !== "WEB" && !value.nativeToken) ctx.addIssue({ code: "custom", message: "native_token_required" });
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const d = parsed.data;
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PushSubscription" ("id","userId","platform","endpoint","p256dh","auth","nativeToken","deviceLabel","userAgent") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT ("endpoint") WHERE "endpoint" IS NOT NULL DO UPDATE SET "userId"=EXCLUDED."userId","isActive"=TRUE,"lastSeenAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP`,
      id, user.id, d.platform, d.endpoint ?? null, d.keys?.p256dh ?? null, d.keys?.auth ?? null, d.nativeToken ?? null, d.deviceLabel ?? null, request.headers["user-agent"]?.slice(0, 500) ?? null,
    );
    if (d.nativeToken) {
      await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "userId"=$1,"platform"=$2,"isActive"=TRUE,"lastSeenAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "nativeToken"=$3`, user.id, d.platform, d.nativeToken);
    }
    return reply.code(201).send({ subscribed: true });
  });

  app.post("/notifications/push/unsubscribe", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ endpoint: z.string().url().optional(), nativeToken: z.string().min(16).optional() }).safeParse(request.body);
    if (!parsed.success || (!parsed.data.endpoint && !parsed.data.nativeToken)) return reply.code(400).send({ error: "invalid_request" });
    if (parsed.data.endpoint) await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "isActive"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "endpoint"=$2`, user.id, parsed.data.endpoint);
    if (parsed.data.nativeToken) await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "isActive"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "nativeToken"=$2`, user.id, parsed.data.nativeToken);
    return reply.send({ unsubscribed: true });
  });

  app.get("/notifications/preferences", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    await prisma.$executeRawUnsafe(`INSERT INTO "NotificationPreference" ("id","userId") VALUES ($1,$2) ON CONFLICT ("userId") DO NOTHING`, randomUUID(), user.id);
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "messages","offers","orders","promotions","savedSearches","security","updatedAt" FROM "NotificationPreference" WHERE "userId"=$1 LIMIT 1`, user.id);
    return reply.send({ preferences: rows[0] });
  });

  app.put("/notifications/preferences", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ messages: z.boolean(), offers: z.boolean(), orders: z.boolean(), promotions: z.boolean(), savedSearches: z.boolean(), security: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const d = parsed.data;
    await prisma.$executeRawUnsafe(`INSERT INTO "NotificationPreference" ("id","userId","messages","offers","orders","promotions","savedSearches","security") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("userId") DO UPDATE SET "messages"=EXCLUDED."messages","offers"=EXCLUDED."offers","orders"=EXCLUDED."orders","promotions"=EXCLUDED."promotions","savedSearches"=EXCLUDED."savedSearches","security"=EXCLUDED."security","updatedAt"=CURRENT_TIMESTAMP`, randomUUID(), user.id, d.messages, d.offers, d.orders, d.promotions, d.savedSearches, d.security);
    return reply.send({ saved: true });
  });
}
