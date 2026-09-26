import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";
import { getGa4OrganicFunnel, getGa4Summary, type Ga4OrganicFunnel } from "./ga4-reporting.js";
import { ensureGa4KeyEvents, listGa4KeyEvents } from "./ga4-admin.js";
import { getSearchConsoleOrganic, type SearchConsoleOrganicReport } from "./search-console-reporting.js";
import { getMetaConversionStatus } from "./meta-conversions.js";

const ROLES=["SUPER_ADMIN","ADMIN","FINANCE","MARKETING","SUPPORT","MODERATOR","COMPLIANCE"] as const;
const KEY_EVENTS=["sign_up","listing_submitted","purchase"];
const sourceSql=`CASE
 WHEN LOWER(COALESCE("trafficSource","source",'')) IN ('meta','facebook','fb','instagram','ig') THEN 'meta'
 WHEN LOWER(COALESCE("trafficSource","source",'')) LIKE '%google%' THEN 'google'
 WHEN LOWER(COALESCE("trafficSource","source",'')) LIKE '%bing%' OR LOWER(COALESCE("trafficSource","source",'')) LIKE '%microsoft%' THEN 'bing'
 WHEN LOWER(COALESCE("trafficSource","source",'')) LIKE '%tiktok%' THEN 'tiktok'
 WHEN LOWER(COALESCE("trafficSource","source",'')) LIKE '%linkedin%' THEN 'linkedin'
 WHEN COALESCE("trafficSource","source",'')='' AND ("referrer" ILIKE '%facebook.com%' OR "referrer" ILIKE '%instagram.com%') THEN 'meta'
 WHEN COALESCE("trafficSource","source",'')='' AND "referrer" ILIKE '%google.%' THEN 'google'
 WHEN COALESCE("trafficSource","source",'')='' AND ("referrer" IS NULL OR "referrer"='' OR "referrer" ILIKE '%petitannonces.fr%') THEN 'direct'
 WHEN LOWER(COALESCE("trafficSource","source",'')) IN ('direct','') THEN 'direct'
 WHEN LOWER(COALESCE("trafficSource","source",''))='referral' THEN 'referral'
 ELSE LOWER(COALESCE("trafficSource","source",'other')) END`;
const signupSourceCase=`CASE
 WHEN a."source" IS NULL THEN 'unknown'
 WHEN LOWER(a."source")='google' AND LOWER(COALESCE(a."medium",'')) IN ('cpc','ppc','paid','paid_search') THEN 'google_ads'
 WHEN LOWER(a."source")='google' THEN 'google_organic'
 WHEN LOWER(a."source")='meta' AND LOWER(COALESCE(a."medium",'')) IN ('cpc','paid','paid_social') THEN 'meta_ads'
 WHEN LOWER(a."source")='meta' THEN 'meta_social'
 WHEN LOWER(a."source")='outreach' THEN 'outreach'
 WHEN LOWER(a."source")='direct' THEN 'direct'
 WHEN LOWER(a."source")='native' THEN 'native'
 WHEN LOWER(a."source")='referral' THEN 'referral'
 WHEN LOWER(a."source") IN ('','unknown') THEN 'unknown'
 ELSE LOWER(a."source") END`;
const signupRankedCte=`WITH acquisition AS (
 SELECT DISTINCT ON (g."userId") g."userId",g."source",g."medium",g."campaign",g."properties",g."occurredAt"
 FROM "GrowthEvent" g
 WHERE g."userId" IS NOT NULL AND g."eventName" IN ('USER_ACQUISITION_REGISTERED','PRO_ACQUISITION_REGISTERED')
 ORDER BY g."userId",CASE WHEN g."eventName"='USER_ACQUISITION_REGISTERED' THEN 0 ELSE 1 END,g."occurredAt" DESC
)`;

function normalizePath(value:string){
 try{const url=value.startsWith("http://")||value.startsWith("https://")?new URL(value):new URL(value,"https://petitannonces.fr");const path=url.pathname.replace(/\/+$/,"")||"/";return path}catch{return value.split("?")[0]?.replace(/\/+$/,"")||"/"}
}

type FirstPartyOrganicLanding={path:string;sessions:number;visitors:number;signUps:number;listingsSubmitted:number;checkoutStarts:number;purchases:number};
type FirstPartyOrganicFunnel={sessions:number;visitors:number;signUps:number;listingsSubmitted:number;checkoutStarts:number;purchases:number;landingPages:FirstPartyOrganicLanding[]};

async function getFirstPartyOrganicFunnel(days:number):Promise<FirstPartyOrganicFunnel>{
 const rows=await prisma.$queryRawUnsafe<Array<any>>(`
 WITH organic_sessions AS (
   SELECT s."sessionId",s."visitorId",s."userId",s."startedAt",
     COALESCE(NULLIF(split_part(s."landingPath",'?',1),''),'/') AS landing
   FROM "SiteAnalyticsSession" s
   WHERE s."startedAt"::date BETWEEN CURRENT_DATE-($1::int+1) AND CURRENT_DATE-2
     AND LOWER(COALESCE(NULLIF(s."trafficSource",''),NULLIF(s."source",''),''))='google'
     AND LOWER(COALESCE(NULLIF(s."trafficMedium",''),NULLIF(s."medium",''),'organic'))='organic'
 ),
 first_user_landing AS (
   SELECT DISTINCT ON ("userId") "userId",landing,"startedAt"
   FROM organic_sessions WHERE "userId" IS NOT NULL
   ORDER BY "userId","startedAt" ASC
 ),
 session_rollup AS (
   SELECT landing,COUNT(DISTINCT "sessionId")::int AS sessions,COUNT(DISTINCT "visitorId")::int AS visitors
   FROM organic_sessions GROUP BY landing
 ),
 user_outcomes AS (
   SELECT f.landing,f."userId",
     CASE WHEN u."createdAt">=f."startedAt" AND u."createdAt"::date<=CURRENT_DATE-2 THEN 1 ELSE 0 END AS signup,
     (SELECT COUNT(*)::int FROM "Listing" l WHERE l."sellerId"=f."userId" AND l."createdAt">=f."startedAt" AND l."createdAt"::date<=CURRENT_DATE-2) AS listings,
     (SELECT COUNT(*)::int FROM "MarketplaceOrder" o WHERE o."buyerId"=f."userId" AND o."createdAt">=f."startedAt" AND o."createdAt"::date<=CURRENT_DATE-2) AS checkouts,
     (SELECT COUNT(*)::int FROM "MarketplaceOrder" o WHERE o."buyerId"=f."userId" AND o."paidAt">=f."startedAt" AND o."paidAt"::date<=CURRENT_DATE-2) AS purchases
   FROM first_user_landing f JOIN "User" u ON u."id"=f."userId"
 ),
 outcome_rollup AS (
   SELECT landing,COALESCE(SUM(signup),0)::int AS "signUps",COALESCE(SUM(listings),0)::int AS "listingsSubmitted",
     COALESCE(SUM(checkouts),0)::int AS "checkoutStarts",COALESCE(SUM(purchases),0)::int AS purchases
   FROM user_outcomes GROUP BY landing
 )
 SELECT s.landing AS path,s.sessions,s.visitors,COALESCE(o."signUps",0)::int AS "signUps",
   COALESCE(o."listingsSubmitted",0)::int AS "listingsSubmitted",COALESCE(o."checkoutStarts",0)::int AS "checkoutStarts",
   COALESCE(o.purchases,0)::int AS purchases
 FROM session_rollup s LEFT JOIN outcome_rollup o USING(landing)
 ORDER BY s.sessions DESC,s.visitors DESC LIMIT 100`,days);
 const landingPages=rows.map(r=>({path:String(r.path||"/"),sessions:Number(r.sessions||0),visitors:Number(r.visitors||0),signUps:Number(r.signUps||0),listingsSubmitted:Number(r.listingsSubmitted||0),checkoutStarts:Number(r.checkoutStarts||0),purchases:Number(r.purchases||0)}));
 return{sessions:landingPages.reduce((s,r)=>s+r.sessions,0),visitors:landingPages.reduce((s,r)=>s+r.visitors,0),signUps:landingPages.reduce((s,r)=>s+r.signUps,0),listingsSubmitted:landingPages.reduce((s,r)=>s+r.listingsSubmitted,0),checkoutStarts:landingPages.reduce((s,r)=>s+r.checkoutStarts,0),purchases:landingPages.reduce((s,r)=>s+r.purchases,0),landingPages};
}

function mergeOrganic(gsc:SearchConsoleOrganicReport,ga4:Ga4OrganicFunnel,firstParty:FirstPartyOrganicFunnel){
 type Landing={path:string;clicks:number;impressions:number;ctr:number;position:number;sessions:number;signUps:number;listingsSubmitted:number;checkoutStarts:number;purchases:number};
 const map=new Map<string,Landing>();
 for(const row of gsc.rows){const path=normalizePath(row.page);const current=map.get(path)??{path,clicks:0,impressions:0,ctr:0,position:0,sessions:0,signUps:0,listingsSubmitted:0,checkoutStarts:0,purchases:0};const previousImpressions=current.impressions;current.clicks+=row.clicks;current.impressions+=row.impressions;current.position=current.impressions?((current.position*previousImpressions)+(row.position*row.impressions))/current.impressions:0;current.ctr=current.impressions?current.clicks/current.impressions:0;map.set(path,current)}
 for(const row of firstParty.landingPages){const path=normalizePath(row.path);const current=map.get(path)??{path,clicks:0,impressions:0,ctr:0,position:0,sessions:0,signUps:0,listingsSubmitted:0,checkoutStarts:0,purchases:0};current.sessions+=row.sessions;current.signUps+=row.signUps;current.listingsSubmitted+=row.listingsSubmitted;current.checkoutStarts+=row.checkoutStarts;current.purchases+=row.purchases;map.set(path,current)}
 const landingPages=[...map.values()].sort((a,b)=>b.clicks-a.clicks||b.sessions-a.sessions||b.impressions-a.impressions).slice(0,40);
 const landingByPath=new Map(landingPages.map(row=>[row.path,row]));
 const queries=gsc.rows.slice().sort((a,b)=>b.clicks-a.clicks||b.impressions-a.impressions).slice(0,60).map(row=>{const path=normalizePath(row.page);const landing=landingByPath.get(path);return{query:row.query,page:path,clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position,landingMetrics:landing?{sessions:landing.sessions,signUps:landing.signUps,listingsSubmitted:landing.listingsSubmitted,checkoutStarts:landing.checkoutStarts,purchases:landing.purchases}:null,conversionScope:"LANDING_PAGE" as const}});
 return{
  connected:gsc.connected&&(ga4.connected||firstParty.sessions>0),
  gsc:{connected:gsc.connected,siteUrl:gsc.siteUrl,serviceAccountEmail:gsc.serviceAccountEmail,source:gsc.source,syncedAt:gsc.syncedAt,errorCode:gsc.errorCode,errorMessage:gsc.errorMessage,startDate:gsc.startDate,endDate:gsc.endDate,clicks:gsc.clicks,impressions:gsc.impressions,ctr:gsc.ctr,position:gsc.position},
  ga4:{connected:ga4.connected,propertyId:ga4.propertyId,errorCode:ga4.errorCode,errorMessage:ga4.errorMessage,sessions:ga4.sessions,signUps:ga4.signUps,listingsSubmitted:ga4.listingsSubmitted,checkoutStarts:ga4.checkoutStarts,purchases:ga4.purchases},
  firstParty:{sessions:firstParty.sessions,visitors:firstParty.visitors,signUps:firstParty.signUps,listingsSubmitted:firstParty.listingsSubmitted,checkoutStarts:firstParty.checkoutStarts,purchases:firstParty.purchases},
  funnel:{impressions:gsc.impressions,clicks:gsc.clicks,sessions:firstParty.sessions,signUps:firstParty.signUps,listingsSubmitted:firstParty.listingsSubmitted,checkoutStarts:firstParty.checkoutStarts,purchases:firstParty.purchases},
  landingPages,queries,
  queryAttribution:"Search Console query data is aggregated. Downstream conversion metrics shown beside a query belong to that landing page, not to an individually identified query session.",
  gscDetailRowsAreTopRows:true,
 };
}

export async function registerAdminAnalyticsRoutes(app:FastifyInstance){
 app.get("/admin/analytics/summary",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{
  const parsed=z.object({days:z.coerce.number().int().min(7).max(365).default(30)}).safeParse(request.query);
  if(!parsed.success)return reply.code(400).send({error:"invalid_period"});
  const days=parsed.data.days;
  const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT
    (SELECT COUNT(*) FROM "User" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "newUsers",
    (SELECT COUNT(*) FROM "Listing" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "newListings",
    (SELECT COUNT(*) FROM "Listing" WHERE "publishedAt">=CURRENT_DATE-($1::int-1))::int AS "publishedListings",
    (SELECT COUNT(*) FROM "MarketplaceOrder" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "orders",
    (SELECT COUNT(*) FROM "MarketplaceOrder" WHERE "paidAt">=CURRENT_DATE-($1::int-1))::int AS "paidOrders",
    COALESCE((SELECT SUM("totalAmountMinor") FROM "MarketplaceOrder" WHERE "paidAt">=CURRENT_DATE-($1::int-1)),0)::bigint AS "gmvMinor",
    COALESCE((SELECT SUM("platformCommissionMinor") FROM "MarketplaceOrder" WHERE "paidAt">=CURRENT_DATE-($1::int-1)),0)::bigint AS "revenueMinor",
    (SELECT COUNT(*) FROM "MarketplaceDispute" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "disputes",
    (SELECT COUNT(*) FROM "SupportTicket" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "supportTickets"`,days);
  const s=rows[0]??{};
  return reply.send({days,summary:{...s,gmvMinor:Number(s.gmvMinor??0),revenueMinor:Number(s.revenueMinor??0)}});
 });
 app.get("/admin/analytics/overview",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{
  const parsed=z.object({days:z.coerce.number().int().min(7).max(365).default(30)}).safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"invalid_period"});const days=parsed.data.days;
  const [series,summary,listingStatuses,userKinds,audience,dailyAudience,trafficSources,signupSourcesToday,recentSignupSourcesToday,ga4,ga4Organic,gsc,firstPartyOrganic,keyEvents,metaStatus]=await Promise.all([
   prisma.$queryRawUnsafe<Array<any>>(`WITH days AS (SELECT generate_series(CURRENT_DATE-($1::int-1),CURRENT_DATE,'1 day'::interval)::date AS d) SELECT d, (SELECT COUNT(*)::int FROM "User" u WHERE u."createdAt"::date=d) AS "newUsers", (SELECT COUNT(*)::int FROM "Listing" l WHERE l."createdAt"::date=d) AS "newListings", (SELECT COUNT(*)::int FROM "Listing" l WHERE l."publishedAt"::date=d) AS "publishedListings", (SELECT COUNT(*)::int FROM "MarketplaceOrder" o WHERE o."createdAt"::date=d) AS "orders", (SELECT COUNT(*)::int FROM "MarketplaceOrder" o WHERE o."paidAt"::date=d) AS "paidOrders", COALESCE((SELECT SUM(o."totalAmountMinor") FROM "MarketplaceOrder" o WHERE o."paidAt"::date=d),0)::bigint AS "gmvMinor", COALESCE((SELECT SUM(o."platformCommissionMinor") FROM "MarketplaceOrder" o WHERE o."paidAt"::date=d),0)::bigint AS "revenueMinor" FROM days ORDER BY d ASC`,days),
   prisma.$queryRawUnsafe<Array<any>>(`SELECT (SELECT COUNT(*) FROM "User" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "newUsers", (SELECT COUNT(*) FROM "Listing" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "newListings", (SELECT COUNT(*) FROM "Listing" WHERE "publishedAt">=CURRENT_DATE-($1::int-1))::int AS "publishedListings", (SELECT COUNT(*) FROM "MarketplaceOrder" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "orders", (SELECT COUNT(*) FROM "MarketplaceOrder" WHERE "paidAt">=CURRENT_DATE-($1::int-1))::int AS "paidOrders", COALESCE((SELECT SUM("totalAmountMinor") FROM "MarketplaceOrder" WHERE "paidAt">=CURRENT_DATE-($1::int-1)),0)::bigint AS "gmvMinor", COALESCE((SELECT SUM("platformCommissionMinor") FROM "MarketplaceOrder" WHERE "paidAt">=CURRENT_DATE-($1::int-1)),0)::bigint AS "revenueMinor", (SELECT COUNT(*) FROM "MarketplaceDispute" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "disputes", (SELECT COUNT(*) FROM "SupportTicket" WHERE "createdAt">=CURRENT_DATE-($1::int-1))::int AS "supportTickets"`,days),
   prisma.$queryRawUnsafe<Array<any>>(`SELECT "status",COUNT(*)::int AS count FROM "Listing" GROUP BY "status" ORDER BY count DESC`),
   prisma.$queryRawUnsafe<Array<any>>(`SELECT "kind",COUNT(*)::int AS count FROM "User" GROUP BY "kind" ORDER BY count DESC`),
   prisma.$queryRawUnsafe<Array<any>>(`SELECT COUNT(DISTINCT "visitorId")::int AS visitors,COUNT(*)::int AS sessions,COALESCE(SUM("pageViews"),0)::int AS "pageViews",COUNT(*) FILTER (WHERE "pwaMode"=TRUE)::int AS "pwaSessions" FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_DATE-($1::int-1)`,days),
   prisma.$queryRawUnsafe<Array<any>>(`WITH days AS (SELECT generate_series(CURRENT_DATE-($1::int-1),CURRENT_DATE,'1 day'::interval)::date AS d) SELECT d,COALESCE((SELECT COUNT(DISTINCT s."visitorId")::int FROM "SiteAnalyticsSession" s WHERE s."startedAt"::date=d),0) AS visitors,COALESCE((SELECT COUNT(*)::int FROM "SiteAnalyticsSession" s WHERE s."startedAt"::date=d),0) AS sessions,COALESCE((SELECT SUM(s."pageViews")::int FROM "SiteAnalyticsSession" s WHERE s."startedAt"::date=d),0) AS "pageViews",COALESCE((SELECT COUNT(DISTINCT s."visitorId")::int FROM "SiteAnalyticsSession" s WHERE s."startedAt"::date=d AND (${sourceSql})='meta'),0) AS "metaVisitors",COALESCE((SELECT COUNT(*)::int FROM "SiteAnalyticsSession" s WHERE s."startedAt"::date=d AND (${sourceSql})='meta'),0) AS "metaSessions" FROM days ORDER BY d ASC`,days),
   prisma.$queryRawUnsafe<Array<any>>(`WITH traffic AS (SELECT ${sourceSql} AS source,"visitorId","pageViews" FROM "SiteAnalyticsSession" WHERE "startedAt">=CURRENT_DATE-($1::int-1)) SELECT source,COUNT(DISTINCT "visitorId")::int AS visitors,COUNT(*)::int AS sessions,COALESCE(SUM("pageViews"),0)::int AS "pageViews" FROM traffic GROUP BY source ORDER BY sessions DESC,visitors DESC`,days),
   prisma.$queryRawUnsafe<Array<any>>(`${signupRankedCte} SELECT ${signupSourceCase} AS source,COUNT(*)::int AS count FROM "User" u LEFT JOIN acquisition a ON a."userId"=u."id" WHERE u."createdAt">=(date_trunc('day',NOW() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris') GROUP BY 1 ORDER BY count DESC,source ASC`),
   prisma.$queryRawUnsafe<Array<any>>(`${signupRankedCte} SELECT u."createdAt",u."kind",u."status",${signupSourceCase} AS source,COALESCE(a."medium",'none') AS medium,a."campaign",a."properties"->>'landingPath' AS "landingPath" FROM "User" u LEFT JOIN acquisition a ON a."userId"=u."id" WHERE u."createdAt">=(date_trunc('day',NOW() AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'Europe/Paris') ORDER BY u."createdAt" DESC LIMIT 20`),
   getGa4Summary(days),
   getGa4OrganicFunnel(days),
   getSearchConsoleOrganic(days),
   getFirstPartyOrganicFunnel(days),
   listGa4KeyEvents(),
   getMetaConversionStatus(),
  ]);
  const s=summary[0]??{},aud=audience[0]??{};return reply.send({days,summary:{...s,gmvMinor:Number(s.gmvMinor??0),revenueMinor:Number(s.revenueMinor??0)},audience:{visitors:Number(aud.visitors??0),sessions:Number(aud.sessions??0),pageViews:Number(aud.pageViews??0),pwaSessions:Number(aud.pwaSessions??0),source:"PETIT_ANNONCES_FIRST_PARTY"},dailyAudience:dailyAudience.map(r=>({d:r.d instanceof Date?r.d.toISOString().slice(0,10):String(r.d).slice(0,10),visitors:Number(r.visitors??0),sessions:Number(r.sessions??0),pageViews:Number(r.pageViews??0),metaVisitors:Number(r.metaVisitors??0),metaSessions:Number(r.metaSessions??0)})),trafficSources:trafficSources.map(r=>({source:String(r.source||"other"),visitors:Number(r.visitors??0),sessions:Number(r.sessions??0),pageViews:Number(r.pageViews??0)})),signupSourcesToday:signupSourcesToday.map(r=>({source:String(r.source||"unknown"),count:Number(r.count??0)})),recentSignupSourcesToday:recentSignupSourcesToday.map(r=>({createdAt:r.createdAt instanceof Date?r.createdAt.toISOString():String(r.createdAt),kind:String(r.kind||"PARTICULIER"),status:String(r.status||""),source:String(r.source||"unknown"),medium:String(r.medium||"none"),campaign:r.campaign?String(r.campaign):null,landingPath:r.landingPath?String(r.landingPath):null})),meta:metaStatus,ga4:{...ga4,tagConfigured:true,reportingConnected:ga4.connected,consentRequired:true,keyEventAdmin:keyEvents},organic:mergeOrganic(gsc,ga4Organic,firstPartyOrganic),series:series.map(r=>({...r,d:r.d instanceof Date?r.d.toISOString().slice(0,10):String(r.d).slice(0,10),gmvMinor:Number(r.gmvMinor??0),revenueMinor:Number(r.revenueMinor??0)})),listingStatuses,userKinds});
 });

 app.post("/admin/analytics/ga4/key-events/sync",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MARKETING"])},async(_request,reply)=>{
  try{return reply.send(await ensureGa4KeyEvents(KEY_EVENTS))}catch(error){return reply.code(502).send({error:"ga4_key_event_sync_failed",message:String((error as Error)?.message??error).slice(0,300)})}
 });
}
