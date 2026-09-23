import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@pa/database";
import { requireAdminRoles } from "./rbac.js";
import { getGa4Summary } from "./ga4-reporting.js";

const ADMIN_ROLES=["SUPER_ADMIN","ADMIN","MARKETING"] as const;
const vitalSchema=z.object({visitorId:z.string().trim().min(8).max(120),sessionId:z.string().trim().min(8).max(120),path:z.string().trim().min(1).max(500),name:z.enum(["CLS","LCP","INP","FCP","TTFB"]),value:z.number().finite().nonnegative(),delta:z.number().finite().optional(),rating:z.enum(["good","needs-improvement","poor"]).optional(),navigationType:z.string().trim().max(80).optional()});
const eventSchema=z.object({
  visitorId:z.string().trim().min(8).max(120),
  sessionId:z.string().trim().min(8).max(120),
  event:z.enum(["PAGE_VIEW","HEARTBEAT","PWA_INSTALLED","PWA_STANDALONE","PWA_ONBOARDING_STARTED","PWA_ONBOARDING_COMPLETED","PWA_PUSH_PROMPTED","PWA_PUSH_ACCEPTED","PWA_PUSH_DECLINED","SIGN_UP_COMPLETED","PHONE_VERIFIED","LISTING_SUBMITTED","MESSAGE_SENT","CHECKOUT_STARTED","PURCHASE_COMPLETED","PRO_TRIAL_STARTED","LANDING_CTA_CLICKED","PHOTO_UPLOAD_FAILED","LISTING_PUBLISH_FAILED","CHECKOUT_FAILED"]),
  path:z.string().trim().min(1).max(500).default("/"),
  referrer:z.string().trim().max(1000).optional(),
  source:z.string().trim().max(120).optional(),
  medium:z.string().trim().max(120).optional(),
  campaign:z.string().trim().max(160).optional(),
  attributionPath:z.string().trim().min(1).max(500).optional(),
  trafficSource:z.string().trim().max(120).optional(),
  trafficMedium:z.string().trim().max(120).optional(),
  trafficCampaign:z.string().trim().max(160).optional(),
  pwaMode:z.boolean().default(false),
});
function sha(v:string){return createHash("sha256").update(v).digest("hex")}
async function ensureSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteAnalyticsVisitor" (
    "visitorId" TEXT PRIMARY KEY,
    "userId" TEXT NULL,
    "firstSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "pwaInstalledAt" TIMESTAMPTZ NULL,
    "pwaStandaloneSeenAt" TIMESTAMPTZ NULL,
    "userAgentHash" TEXT NULL
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteAnalyticsVisitor_lastSeenAt_idx" ON "SiteAnalyticsVisitor" ("lastSeenAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteAnalyticsVisitor_userId_idx" ON "SiteAnalyticsVisitor" ("userId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteAnalyticsSession" (
    "sessionId" TEXT PRIMARY KEY,
    "visitorId" TEXT NOT NULL,
    "userId" TEXT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "landingPath" TEXT NOT NULL,
    "currentPath" TEXT NOT NULL,
    "referrer" TEXT NULL,
    "source" TEXT NULL,
    "medium" TEXT NULL,
    "campaign" TEXT NULL,
    "attributionPath" TEXT NULL,
    "trafficSource" TEXT NULL,
    "trafficMedium" TEXT NULL,
    "trafficCampaign" TEXT NULL,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "pwaMode" BOOLEAN NOT NULL DEFAULT FALSE
  )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SiteAnalyticsSession" ADD COLUMN IF NOT EXISTS "source" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SiteAnalyticsSession" ADD COLUMN IF NOT EXISTS "medium" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SiteAnalyticsSession" ADD COLUMN IF NOT EXISTS "campaign" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SiteAnalyticsSession" ADD COLUMN IF NOT EXISTS "attributionPath" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SiteAnalyticsSession" ADD COLUMN IF NOT EXISTS "trafficSource" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SiteAnalyticsSession" ADD COLUMN IF NOT EXISTS "trafficMedium" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SiteAnalyticsSession" ADD COLUMN IF NOT EXISTS "trafficCampaign" TEXT NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteAnalyticsSession_trafficSource_startedAt_idx" ON "SiteAnalyticsSession" ("trafficSource","startedAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteAnalyticsSession_lastSeenAt_idx" ON "SiteAnalyticsSession" ("lastSeenAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteAnalyticsSession_userId_idx" ON "SiteAnalyticsSession" ("userId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteAnalyticsEvent" (
    "id" BIGSERIAL PRIMARY KEY,"visitorId" TEXT NOT NULL,"sessionId" TEXT NOT NULL,"userId" TEXT NULL,"event" TEXT NOT NULL,"path" TEXT NOT NULL,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteAnalyticsEvent_event_createdAt_idx" ON "SiteAnalyticsEvent" ("event","createdAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteAnalyticsEvent_visitor_event_idx" ON "SiteAnalyticsEvent" ("visitorId","event")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteWebVital" (
    "id" BIGSERIAL PRIMARY KEY,"visitorId" TEXT NOT NULL,"sessionId" TEXT NOT NULL,"userId" TEXT NULL,"path" TEXT NOT NULL,"name" TEXT NOT NULL,"value" DOUBLE PRECISION NOT NULL,"delta" DOUBLE PRECISION NULL,"rating" TEXT NULL,"navigationType" TEXT NULL,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteWebVital_createdAt_idx" ON "SiteWebVital" ("createdAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SiteWebVital_name_idx" ON "SiteWebVital" ("name","createdAt" DESC)`);
}
async function currentUserId(request:FastifyRequest){
  const token=request.cookies?.pa_session;if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:sha(token)},select:{userId:true,revokedAt:true,expiresAt:true}});
  return s&&!s.revokedAt&&s.expiresAt>new Date()?s.userId:null;
}
export async function registerSiteAnalyticsRoutes(app:FastifyInstance){
  await ensureSchema();
  app.post("/analytics/event",async(request,reply)=>{
    const parsed=eventSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_event"});
    const x=parsed.data;const userId=await currentUserId(request);
    const ua=String(request.headers["user-agent"]??"");const uaHash=ua?sha(ua):null;
    await prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`INSERT INTO "SiteAnalyticsVisitor" ("visitorId","userId","firstSeenAt","lastSeenAt","pwaInstalledAt","pwaStandaloneSeenAt","userAgentHash")
        VALUES ($1,$2,NOW(),NOW(),CASE WHEN $3='PWA_INSTALLED' THEN NOW() ELSE NULL END,CASE WHEN $3='PWA_STANDALONE' THEN NOW() ELSE NULL END,$4)
        ON CONFLICT ("visitorId") DO UPDATE SET "userId"=COALESCE(EXCLUDED."userId","SiteAnalyticsVisitor"."userId"),"lastSeenAt"=NOW(),
        "pwaInstalledAt"=CASE WHEN $3='PWA_INSTALLED' THEN COALESCE("SiteAnalyticsVisitor"."pwaInstalledAt",NOW()) ELSE "SiteAnalyticsVisitor"."pwaInstalledAt" END,
        "pwaStandaloneSeenAt"=CASE WHEN $3='PWA_STANDALONE' THEN NOW() ELSE "SiteAnalyticsVisitor"."pwaStandaloneSeenAt" END,
        "userAgentHash"=COALESCE(EXCLUDED."userAgentHash","SiteAnalyticsVisitor"."userAgentHash")`,x.visitorId,userId,x.event,uaHash);
      await tx.$executeRawUnsafe(`INSERT INTO "SiteAnalyticsSession" ("sessionId","visitorId","userId","startedAt","lastSeenAt","landingPath","currentPath","referrer","source","medium","campaign","attributionPath","trafficSource","trafficMedium","trafficCampaign","pageViews","pwaMode")
        VALUES ($1,$2,$3,NOW(),NOW(),$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $13='PAGE_VIEW' THEN 1 ELSE 0 END,$14)
        ON CONFLICT ("sessionId") DO UPDATE SET "userId"=COALESCE(EXCLUDED."userId","SiteAnalyticsSession"."userId"),"lastSeenAt"=NOW(),"currentPath"=$4,
        "source"=COALESCE("SiteAnalyticsSession"."source",EXCLUDED."source"),"medium"=COALESCE("SiteAnalyticsSession"."medium",EXCLUDED."medium"),"campaign"=COALESCE("SiteAnalyticsSession"."campaign",EXCLUDED."campaign"),"attributionPath"=COALESCE("SiteAnalyticsSession"."attributionPath",EXCLUDED."attributionPath"),
        "trafficSource"=COALESCE("SiteAnalyticsSession"."trafficSource",EXCLUDED."trafficSource"),"trafficMedium"=COALESCE("SiteAnalyticsSession"."trafficMedium",EXCLUDED."trafficMedium"),"trafficCampaign"=COALESCE("SiteAnalyticsSession"."trafficCampaign",EXCLUDED."trafficCampaign"),
        "pageViews"="SiteAnalyticsSession"."pageViews"+CASE WHEN $13='PAGE_VIEW' THEN 1 ELSE 0 END,"pwaMode"=("SiteAnalyticsSession"."pwaMode" OR $14)`,x.sessionId,x.visitorId,userId,x.path,x.referrer??null,x.source??null,x.medium??null,x.campaign??null,x.attributionPath??null,x.trafficSource??null,x.trafficMedium??null,x.trafficCampaign??null,x.event,x.pwaMode);
      if(x.event!=="PAGE_VIEW"&&x.event!=="HEARTBEAT") await tx.$executeRawUnsafe(`INSERT INTO "SiteAnalyticsEvent" ("visitorId","sessionId","userId","event","path") VALUES ($1,$2,$3,$4,$5)`,x.visitorId,x.sessionId,userId,x.event,x.path);
    });
    return reply.code(204).send();
  });

  app.post("/analytics/web-vital",async(request,reply)=>{
    const parsed=vitalSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_vital"});
    const x=parsed.data;const userId=await currentUserId(request);
    await prisma.$executeRawUnsafe(`INSERT INTO "SiteWebVital" ("visitorId","sessionId","userId","path","name","value","delta","rating","navigationType") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,x.visitorId,x.sessionId,userId,x.path,x.name,x.value,x.delta??null,x.rating??null,x.navigationType??null);
    return reply.code(204).send();
  });

  app.get("/admin/analytics/live",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(_request,reply)=>{
    const [summary,onlineUsers,onlineSessions,topPages,recentDays,trafficToday,webVitals,recentPwa,ga4]=await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(`SELECT
        (SELECT COUNT(*)::int FROM "SiteAnalyticsVisitor") AS "uniqueVisitors",
        (SELECT COUNT(*)::int FROM "SiteAnalyticsSession") AS "visits",
        (SELECT COALESCE(SUM("pageViews"),0)::int FROM "SiteAnalyticsSession") AS "pageViews",
        (SELECT COUNT(*)::int FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_DATE) AS "visitsToday",
        (SELECT COUNT(DISTINCT "visitorId")::int FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_DATE) AS "visitorsToday",
        (SELECT COALESCE(SUM("pageViews"),0)::int FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_DATE) AS "pageViewsToday",
        (SELECT COUNT(DISTINCT "visitorId")::int FROM "SiteAnalyticsSession" WHERE "lastSeenAt">NOW()-INTERVAL '5 minutes') AS "onlineVisitors",
        (SELECT COUNT(DISTINCT "userId")::int FROM "SiteAnalyticsSession" WHERE "userId" IS NOT NULL AND "lastSeenAt">NOW()-INTERVAL '5 minutes') AS "onlineMembers",
        (SELECT COUNT(*)::int FROM "SiteAnalyticsVisitor" WHERE "pwaInstalledAt" IS NOT NULL) AS "pwaExplicitInstalls",
        (SELECT COUNT(*)::int FROM "SiteAnalyticsVisitor" WHERE "pwaInstalledAt" IS NOT NULL OR "pwaStandaloneSeenAt" IS NOT NULL) AS "pwaInstalledOrDetected",
        (SELECT COUNT(DISTINCT COALESCE("userId","visitorId"))::int FROM "SiteAnalyticsVisitor" WHERE "pwaInstalledAt" IS NOT NULL OR "pwaStandaloneSeenAt" IS NOT NULL) AS "pwaEstimatedUsers",
        (SELECT COUNT(DISTINCT "visitorId")::int FROM "SiteAnalyticsEvent" WHERE "event"='PWA_ONBOARDING_STARTED') AS "pwaOnboardingStarted",
        (SELECT COUNT(DISTINCT "visitorId")::int FROM "SiteAnalyticsEvent" WHERE "event"='PWA_ONBOARDING_COMPLETED') AS "pwaOnboardingCompleted",
        (SELECT COUNT(DISTINCT "visitorId")::int FROM "SiteAnalyticsEvent" WHERE "event"='PWA_PUSH_PROMPTED') AS "pwaPushPrompted",
        (SELECT COUNT(DISTINCT "visitorId")::int FROM "SiteAnalyticsEvent" WHERE "event"='PWA_PUSH_ACCEPTED') AS "pwaPushAccepted",
        (SELECT COUNT(DISTINCT "visitorId")::int FROM "SiteAnalyticsEvent" WHERE "event"='PWA_PUSH_DECLINED') AS "pwaPushDeclined"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT DISTINCT ON (s."userId") s."userId",u."email",COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name",p."avatarUrl",u."kind",s."currentPath",s."landingPath",s."lastSeenAt",s."pwaMode",s."referrer",s."source",s."medium",s."campaign",s."trafficSource",s."trafficMedium",s."trafficCampaign"
        FROM "SiteAnalyticsSession" s JOIN "User" u ON u."id"=s."userId" LEFT JOIN "UserProfile" p ON p."userId"=u."id"
        WHERE s."userId" IS NOT NULL AND s."lastSeenAt">NOW()-INTERVAL '5 minutes'
        ORDER BY s."userId",s."lastSeenAt" DESC LIMIT 50`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT DISTINCT ON (s."visitorId") s."visitorId",s."userId",u."email",
        COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name",
        p."avatarUrl",u."kind",s."currentPath",s."landingPath",s."lastSeenAt",s."pwaMode",s."referrer",
        s."source",s."medium",s."campaign",s."trafficSource",s."trafficMedium",s."trafficCampaign"
        FROM "SiteAnalyticsSession" s
        LEFT JOIN "User" u ON u."id"=s."userId"
        LEFT JOIN "UserProfile" p ON p."userId"=u."id"
        WHERE s."lastSeenAt">NOW()-INTERVAL '5 minutes'
        ORDER BY s."visitorId",s."lastSeenAt" DESC LIMIT 100`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT "currentPath" AS path,COUNT(*)::int AS sessions,COALESCE(SUM("pageViews"),0)::int AS "pageViews" FROM "SiteAnalyticsSession" WHERE "lastSeenAt">NOW()-INTERVAL '24 hours' GROUP BY "currentPath" ORDER BY "pageViews" DESC LIMIT 8`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT DATE("startedAt") AS day,COUNT(*)::int AS visits,COUNT(DISTINCT "visitorId")::int AS visitors,COALESCE(SUM("pageViews"),0)::int AS "pageViews" FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_DATE-INTERVAL '13 days' GROUP BY DATE("startedAt") ORDER BY day ASC`),
      prisma.$queryRawUnsafe<Array<any>>(`WITH t AS (SELECT CASE WHEN LOWER(COALESCE("trafficSource","source",'')) IN ('meta','facebook','fb','instagram','ig') THEN 'meta' WHEN LOWER(COALESCE("trafficSource","source",'')) LIKE '%google%' THEN 'google' WHEN LOWER(COALESCE("trafficSource","source",'')) LIKE '%bing%' OR LOWER(COALESCE("trafficSource","source",'')) LIKE '%microsoft%' THEN 'bing' WHEN LOWER(COALESCE("trafficSource","source",'')) LIKE '%tiktok%' THEN 'tiktok' WHEN COALESCE("trafficSource","source",'')='' AND ("referrer" ILIKE '%facebook.com%' OR "referrer" ILIKE '%instagram.com%') THEN 'meta' WHEN COALESCE("trafficSource","source",'')='' AND "referrer" ILIKE '%google.%' THEN 'google' WHEN COALESCE("trafficSource","source",'')='' AND ("referrer" IS NULL OR "referrer"='' OR "referrer" ILIKE '%petitannonces.fr%') THEN 'direct' WHEN LOWER(COALESCE("trafficSource","source",'')) IN ('direct','') THEN 'direct' WHEN LOWER(COALESCE("trafficSource","source",''))='referral' THEN 'referral' ELSE LOWER(COALESCE("trafficSource","source",'other')) END AS source,"visitorId","pageViews" FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_DATE) SELECT source,COUNT(DISTINCT "visitorId")::int AS visitors,COUNT(*)::int AS sessions,COALESCE(SUM("pageViews"),0)::int AS "pageViews" FROM t GROUP BY source ORDER BY sessions DESC`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT "name",COUNT(*)::int AS samples,percentile_cont(0.75) WITHIN GROUP (ORDER BY "value") AS p75 FROM "SiteWebVital" WHERE "createdAt">=NOW()-INTERVAL '7 days' AND "name" IN ('LCP','INP','CLS') GROUP BY "name" ORDER BY "name"`),
      prisma.$queryRawUnsafe<Array<any>>(`SELECT v."visitorId",v."userId",u."email",COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS "name",u."kind",v."firstSeenAt",v."lastSeenAt",v."pwaInstalledAt",v."pwaStandaloneSeenAt",ls."currentPath"
        FROM "SiteAnalyticsVisitor" v
        LEFT JOIN "User" u ON u."id"=v."userId"
        LEFT JOIN "UserProfile" p ON p."userId"=u."id"
        LEFT JOIN LATERAL (SELECT s."currentPath" FROM "SiteAnalyticsSession" s WHERE s."visitorId"=v."visitorId" ORDER BY s."lastSeenAt" DESC LIMIT 1) ls ON TRUE
        WHERE v."pwaInstalledAt" IS NOT NULL OR v."pwaStandaloneSeenAt" IS NOT NULL
        ORDER BY COALESCE(v."pwaInstalledAt",v."pwaStandaloneSeenAt",v."lastSeenAt") DESC LIMIT 20`),
      getGa4Summary(7),
    ]);
    return reply.send({summary:summary[0]??{},onlineUsers,onlineSessions,topPages,recentDays,trafficToday:trafficToday.map(r=>({source:String(r.source||"other"),visitors:Number(r.visitors??0),sessions:Number(r.sessions??0),pageViews:Number(r.pageViews??0)})),webVitals,recentPwa,onlineWindowMinutes:5,trackingStarted:true,ga4:{...ga4,tagConfigured:true,reportingConnected:ga4.connected,consentRequired:true}});
  });
}