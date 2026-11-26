import {prisma} from "@pa/database";
import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {requireAdminRoles} from "./rbac.js";
const ROLES=["SUPER_ADMIN","ADMIN"] as const;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v});
const query=z.object({q:z.string().trim().max(120).default(""),action:z.string().max(100).default(""),entity:z.string().max(100).default(""),actor:z.string().max(128).default(""),from:date.optional(),to:date.optional(),page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(20).max(200).default(50)}).refine(v=>!v.from||!v.to||v.from<=v.to);
const safeKeys=new Set(["reason","from","to","previous","after","before","status","previousStatus","enabled","isActive","count","roles","removedRole","kind","manualListingReview","fields","configKeys","secretKeysUpdated","maxActiveListings","maxStores","monthlyPriceMinor","yearlyPriceMinor","priceMinor","commissionRateBps","commissionUntil","commissionCustomized","publicationBlocked","messagingBlocked","importBlocked","storeCreationBlocked","listingCap","storeCap","salesBlocked","durationHours","days","internalNote","emailVerified","mediaCount","mode","provider","source","refundStatus","analyticsEnabled","autoRenewListings","apiFeedEnabled","bulkImportEnabled","prioritySupport","featuredCreditsMonthly","lookupEnabled","registryConfirmed","authorityConfirmed","verificationMethod","manual","directUpload","action","entityType","type","value","revision","listingSubmission","listingImport","newMessages","storeCreation","newPromotions","listingSubmissionEnabled"]);
export function auditMetadata(value:unknown,depth=0):unknown{
 if(depth>5)return "[Limite de profondeur]";
 if(value===null||typeof value==="boolean"||typeof value==="number")return value;
 if(typeof value==="string")return value.slice(0,500);
 if(Array.isArray(value))return value.slice(0,30).map(v=>auditMetadata(v,depth+1));
 if(value&&typeof value==="object"){const result:Record<string,unknown>={};let hidden=0;for(const [k,v] of Object.entries(value)){if(safeKeys.has(k))result[k]=auditMetadata(v,depth+1);else hidden++}if(hidden)result.champsNonAffiches=hidden;return result}
 return null;
}
export async function registerAdminAuditRoutes(app:FastifyInstance){
 app.get("/admin/audit",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{
 const parsed=query.safeParse(request.query);if(!parsed.success)return reply.code(400).send({error:"invalid_request"});
 const v=parsed.data;
 const [events,total,summary,actions,entities,actors]=await prisma.$transaction(async tx=>{
 await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
 const where=`FROM "AdminAuditEvent" a LEFT JOIN "User" u ON u.id=a."actorUserId" WHERE ($1='' OR a.action ILIKE '%'||$1||'%' OR a."entityType" ILIKE '%'||$1||'%' OR COALESCE(a."entityId",'') ILIKE '%'||$1||'%' OR COALESCE(u.email,'') ILIKE '%'||$1||'%') AND ($2='' OR a.action=$2) AND ($3='' OR a."entityType"=$3) AND ($4='' OR a."actorUserId"=$4 OR ($4='__system' AND a."actorUserId" IS NULL)) AND ($5::date IS NULL OR a."createdAt">=(($5::date::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC')) AND ($6::date IS NULL OR a."createdAt"<((($6::date+1)::timestamp AT TIME ZONE 'Europe/Paris') AT TIME ZONE 'UTC'))`;
 const args=[v.q,v.action,v.entity,v.actor,v.from??null,v.to??null];
 return Promise.all([
 tx.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT a.id,a.action,a."entityType",a."entityId",a.metadata,a."createdAt",u.email AS "actorEmail",COALESCE((SELECT COALESCE(p."displayName",p."firstName") FROM "UserProfile" p WHERE p."userId"=u.id),u.email,CASE WHEN a."actorUserId" IS NULL THEN 'Système' ELSE 'Compte indisponible' END) AS "actorName" ${where} ORDER BY a."createdAt" DESC,a.id DESC LIMIT $7 OFFSET $8`,...args,v.limit,(v.page-1)*v.limit),
 tx.$queryRawUnsafe<Array<{count:number}>>(`SELECT COUNT(*)::int AS count ${where}`,...args),
 tx.$queryRaw<Array<{total:number;recent:number;actors:number}>>`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE "createdAt">=NOW()-INTERVAL '24 hours')::int AS recent,COUNT(DISTINCT "actorUserId")::int AS actors FROM "AdminAuditEvent"`,
 tx.$queryRaw<Array<{value:string;count:number}>>`SELECT action AS value,COUNT(*)::int AS count FROM "AdminAuditEvent" GROUP BY action ORDER BY action LIMIT 300`,
 tx.$queryRaw<Array<{value:string;count:number}>>`SELECT "entityType" AS value,COUNT(*)::int AS count FROM "AdminAuditEvent" GROUP BY "entityType" ORDER BY "entityType" LIMIT 100`,
 tx.$queryRaw<Array<{value:string;label:string;count:number}>>`SELECT COALESCE(a."actorUserId",'__system') AS value,COALESCE(u.email,CASE WHEN a."actorUserId" IS NULL THEN 'Système' ELSE 'Compte indisponible' END) AS label,COUNT(*)::int AS count FROM "AdminAuditEvent" a LEFT JOIN "User" u ON u.id=a."actorUserId" GROUP BY a."actorUserId",u.email ORDER BY count DESC LIMIT 200`
 ]);
 },{timeout:10000});
 return reply.header("Cache-Control","private, no-store").send({events:events.map(e=>({...e,metadata:auditMetadata(e.metadata)})),total:total[0]?.count??0,summary:summary[0],actions,entities,actors,page:v.page,pageSize:v.limit,generatedAt:new Date().toISOString()});
 });
}
