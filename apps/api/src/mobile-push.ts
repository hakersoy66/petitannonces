import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { deliverUserEvent } from "./notification-delivery.js";

const SESSION_COOKIE = "pa_session";
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function bearerToken(request: FastifyRequest) { const raw=request.headers.authorization; if(typeof raw!=="string") return null; const match=/^Bearer\s+(.+)$/i.exec(raw.trim()); return match?.[1]?.trim()||null; }
function requestSessionToken(request: FastifyRequest) { return bearerToken(request) ?? request.cookies[SESSION_COOKIE] ?? null; }

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const token = requestSessionToken(request);
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthorized" }); return null;
  }
  return session.user;
}

export async function registerMobilePushRoutes(app: FastifyInstance) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "NotificationPreference" ADD COLUMN IF NOT EXISTS "favorites" BOOLEAN NOT NULL DEFAULT TRUE`);

  app.get("/notifications/push/public-key", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";
    return reply.send({ configured: Boolean(publicKey), publicKey: publicKey || null });
  });

  app.get("/notifications/push/status", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed=z.object({endpoint:z.string().url().optional()}).safeParse(request.query??{});
    if(!parsed.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<{active:boolean;activeCount:bigint}>>(`SELECT EXISTS(SELECT 1 FROM "PushSubscription" WHERE "userId"=$1 AND "isActive"=TRUE AND ($2::text IS NULL OR "endpoint"=$2)) AS active,(SELECT COUNT(*)::bigint FROM "PushSubscription" WHERE "userId"=$1 AND "isActive"=TRUE) AS "activeCount"`,user.id,parsed.data.endpoint??null);
    return reply.send({active:Boolean(rows[0]?.active),activeCount:Number(rows[0]?.activeCount??0n),endpoint:parsed.data.endpoint??null});
  });

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
    const userAgent = request.headers["user-agent"]?.slice(0, 500) ?? null;
    if (d.platform === "WEB") {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PushSubscription" ("id","userId","platform","endpoint","p256dh","auth","deviceLabel","userAgent") VALUES ($1,$2,'WEB',$3,$4,$5,$6,$7)
         ON CONFLICT ("endpoint") WHERE "endpoint" IS NOT NULL DO UPDATE SET "userId"=EXCLUDED."userId","platform"='WEB',"p256dh"=EXCLUDED."p256dh","auth"=EXCLUDED."auth","deviceLabel"=EXCLUDED."deviceLabel","userAgent"=EXCLUDED."userAgent","isActive"=TRUE,"lastSeenAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP`,
        id, user.id, d.endpoint!, d.keys!.p256dh, d.keys!.auth, d.deviceLabel ?? null, userAgent,
      );
    } else {
      if (d.deviceLabel) {
        await prisma.$executeRawUnsafe(`UPDATE "PushSubscription" SET "isActive"=FALSE,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "platform"=$2 AND split_part(COALESCE("deviceLabel",''),' · ',1)=split_part($3,' · ',1) AND "nativeToken" IS DISTINCT FROM $4`, user.id, d.platform, d.deviceLabel, d.nativeToken!);
      }
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PushSubscription" ("id","userId","platform","nativeToken","deviceLabel","userAgent") VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ("nativeToken") WHERE "nativeToken" IS NOT NULL DO UPDATE SET "userId"=EXCLUDED."userId","platform"=EXCLUDED."platform","deviceLabel"=EXCLUDED."deviceLabel","userAgent"=EXCLUDED."userAgent","isActive"=TRUE,"lastSeenAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP`,
        id, user.id, d.platform, d.nativeToken!, d.deviceLabel ?? null, userAgent,
      );
    }
    return reply.code(201).send({ subscribed: true, platform: d.platform });
  });

  app.post("/notifications/push/diagnostic", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({
      platform: z.enum(["IOS","ANDROID"]),
      stage: z.enum(["permission","native_token","expo_token","subscribe","token_refresh","received","opened"]),
      code: z.string().trim().min(1).max(160),
      appVersion: z.string().trim().max(40).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,'MOBILE_PUSH_DIAGNOSTIC','MOBILE_PUSH',$3,$4::jsonb)`,
      randomUUID(), user.id, parsed.data.stage, JSON.stringify({ platform: parsed.data.platform, code: parsed.data.code, appVersion: parsed.data.appVersion ?? null }),
    ).catch(() => undefined);
    return reply.code(204).send();
  });

  app.post("/notifications/push/test", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const result = await deliverUserEvent({
      userId: user.id,
      eventKind: "LISTING",
      notificationKind: "SYSTEM",
      title: "Notifications activées",
      body: "Petit Annonces peut maintenant vous prévenir pour vos messages, offres, commandes et mises à jour importantes.",
      actionUrl: "/mon-compte/notifications",
      metadata: { purpose:"MOBILE_PUSH_TEST" },
      suppressEmail: true,
      forcePush: true,
    });
    return reply.code(202).send({ queued: result.pushQueued, inApp: result.inApp });
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
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "messages","offers","orders","promotions","savedSearches","security","favorites","updatedAt" FROM "NotificationPreference" WHERE "userId"=$1 LIMIT 1`, user.id);
    return reply.send({ preferences: rows[0] });
  });

  app.put("/notifications/preferences", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ messages: z.boolean(), offers: z.boolean(), orders: z.boolean(), promotions: z.boolean(), savedSearches: z.boolean(), security: z.boolean(), favorites:z.boolean().default(true) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const d = parsed.data;
    await prisma.$executeRawUnsafe(`INSERT INTO "NotificationPreference" ("id","userId","messages","offers","orders","promotions","savedSearches","security","favorites") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT ("userId") DO UPDATE SET "messages"=EXCLUDED."messages","offers"=EXCLUDED."offers","orders"=EXCLUDED."orders","promotions"=EXCLUDED."promotions","savedSearches"=EXCLUDED."savedSearches","security"=EXCLUDED."security","favorites"=EXCLUDED."favorites","updatedAt"=CURRENT_TIMESTAMP`, randomUUID(), user.id, d.messages, d.offers, d.orders, d.promotions, d.savedSearches, d.security, d.favorites);
    return reply.send({ saved: true });
  });
}
