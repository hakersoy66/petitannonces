import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@pa/database";
import { requireAdminRoles } from "./rbac.js";

// Privacy-first, consent-independent site-volume signals. The payload NEVER
// accepts IPs, user IDs, browser IDs, paths, referrers or marketing data.
// Only anonymous per-minute counters are persisted (100 days).
const payload = z.object({event:z.enum(["entry","view","pulse"])}).strict();
const ADMIN_ROLES=["SUPER_ADMIN","ADMIN","MARKETING"] as const;
const expectedOrigins=new Set(["https://petitannonces.fr","https://www.petitannonces.fr"]);
const isBot=(ua:string)=>!ua||/bot|spider|crawler|crawl|facebookexternalhit|preview|headless|lighthouse|pagespeed|wget|curl|python-requests|go-http-client|uptime|pingdom|monitor|ahrefs|semrush|googleother|bytespider/i.test(ua);

async function ensureAnonymousAudienceTable(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SiteAudienceAggregate" (
  "bucket" TIMESTAMPTZ PRIMARY KEY,
  "entries" INTEGER NOT NULL DEFAULT 0,
  "pageViews" INTEGER NOT NULL DEFAULT 0,
  "pulses" INTEGER NOT NULL DEFAULT 0
 )`);
}

export async function registerAnonymousAudienceRoutes(app:FastifyInstance){
 await ensureAnonymousAudienceTable();
 app.post("/audience/aggregate",async(request,reply)=>{
  const origin=String(request.headers.origin??"");
  // Reject cross-origin/background data injection; no third-party sharing.
  if(!expectedOrigins.has(origin))return reply.code(403).send({error:"forbidden_origin"});
  if(isBot(String(request.headers["user-agent"]??"")))return reply.code(204).send();
  const result=payload.safeParse(request.body);
  if(!result.success)return reply.code(400).send({error:"invalid_audience_event"});
  const [entries,views,pulses]=result.data.event==="entry"?[1,1,0]:result.data.event==="view"?[0,1,0]:[0,0,1];
  await prisma.$executeRawUnsafe(`INSERT INTO "SiteAudienceAggregate" ("bucket","entries","pageViews","pulses")
    VALUES (date_trunc('minute',NOW()),$1,$2,$3)
    ON CONFLICT ("bucket") DO UPDATE SET
    "entries"="SiteAudienceAggregate"."entries"+EXCLUDED."entries",
    "pageViews"="SiteAudienceAggregate"."pageViews"+EXCLUDED."pageViews",
    "pulses"="SiteAudienceAggregate"."pulses"+EXCLUDED."pulses"`,entries,views,pulses);
  return reply.code(204).send();
 });
 app.get("/admin/analytics/anonymous-audience",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
  const query=z.object({days:z.coerce.number().int().min(1).max(90).default(30)}).safeParse(request.query);
  if(!query.success)return reply.code(400).send({error:"invalid_period"});
  const [today,period,live,first,comparison]=await Promise.all([
   prisma.$queryRawUnsafe<Array<{entries:number;views:number}>>(`SELECT COALESCE(SUM("entries"),0)::int AS entries,COALESCE(SUM("pageViews"),0)::int AS views
      FROM "SiteAudienceAggregate" WHERE "bucket">=(date_trunc('day',NOW() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris')`),
   prisma.$queryRawUnsafe<Array<{entries:number;views:number;day:string}>>(`SELECT TO_CHAR("bucket" AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') AS day,
      COALESCE(SUM("entries"),0)::int AS entries,COALESCE(SUM("pageViews"),0)::int AS views
      FROM "SiteAudienceAggregate" WHERE "bucket">=NOW()-($1::int||' days')::interval
      GROUP BY 1 ORDER BY 1`,query.data.days),
   prisma.$queryRawUnsafe<Array<{signals:number}>>(`SELECT COALESCE(SUM("pulses"),0)::int AS signals FROM "SiteAudienceAggregate" WHERE "bucket">=date_trunc('minute',NOW())-INTERVAL '2 minutes'`),
   prisma.$queryRawUnsafe<Array<{firstAt:Date|null}>>(`SELECT MIN("bucket") AS "firstAt" FROM "SiteAudienceAggregate"`),
   prisma.$queryRawUnsafe<Array<{recent7:number;previous7:number}>>(`SELECT
     COALESCE(SUM("entries") FILTER (WHERE ("bucket" AT TIME ZONE 'Europe/Paris')::date BETWEEN (NOW() AT TIME ZONE 'Europe/Paris')::date-7 AND (NOW() AT TIME ZONE 'Europe/Paris')::date-1),0)::int AS "recent7",
     COALESCE(SUM("entries") FILTER (WHERE ("bucket" AT TIME ZONE 'Europe/Paris')::date BETWEEN (NOW() AT TIME ZONE 'Europe/Paris')::date-14 AND (NOW() AT TIME ZONE 'Europe/Paris')::date-8),0)::int AS "previous7"
     FROM "SiteAudienceAggregate" WHERE "bucket">=NOW()-INTERVAL '16 days'`)
  ]);
  reply.header("Cache-Control","private, no-store");
  return {today:{estimatedEntries:today[0]?.entries??0,pageViews:today[0]?.views??0},
    period:{days:query.data.days,estimatedEntries:period.reduce((t,row)=>t+row.entries,0),
      pageViews:period.reduce((t,row)=>t+row.views,0),daily:period},
    live:{recentPulseSignals:live[0]?.signals??0,onlineTabsApprox:Math.round((live[0]?.signals??0)/2)},
    firstMeasuredAt:first[0]?.firstAt??null,
    comparison:{recent7:comparison[0]?.recent7??0,previous7:comparison[0]?.previous7??0,period:"last_two_complete_7_day_windows"},
    method:"anonymous_aggregate_no_identifiers",note:"Estimation de chargements de site et d'onglets actifs, et non nombre exact de personnes uniques. Aucune identification ou attribution publicitaire."};
 });
 // Keep only anonymous, aggregated 1-minute data for a short fixed period.
 const cleanup=async()=>{try{await prisma.$executeRawUnsafe(`DELETE FROM "SiteAudienceAggregate" WHERE "bucket"<NOW()-INTERVAL '100 days'`)}catch(e){app.log.warn({err:e},"anonymous audience cleanup failed")}};
 void cleanup();
 const cleanupTimer=setInterval(()=>void cleanup(),24*60*60*1000);
 cleanupTimer.unref();
 app.addHook("onClose",async()=>clearInterval(cleanupTimer));
}
