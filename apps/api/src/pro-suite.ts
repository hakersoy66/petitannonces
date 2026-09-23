import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { deliverUserEvent } from "./notification-delivery.js";
import { sendApplicationEmail } from "./email-provider.js";

type ProRole="OWNER"|"MANAGER"|"SALES"|"CATALOG";
type ProPermission="DASHBOARD"|"CRM"|"APPOINTMENTS"|"ANALYTICS"|"LISTINGS"|"IMPORT"|"TEAM_VIEW"|"TEAM_MANAGE"|"BUSINESS"|"BILLING";
export type ProfessionalSector="AUTOMOBILE"|"IMMOBILIER"|"COMMERCE"|"VACANCES"|"SERVICES"|"GENERAL";
export type ProfessionalSectorFeatures={crm:boolean;appointments:boolean;team:boolean;reservations:boolean;feed:boolean;sales:boolean};
export type ProfessionalAccessContext={actorUserId:string;ownerUserId:string;role:ProRole;isOwner:boolean;permissions:ProPermission[];sector:ProfessionalSector;features:ProfessionalSectorFeatures};

const SECTOR_FEATURES:Record<ProfessionalSector,ProfessionalSectorFeatures>={
 AUTOMOBILE:{crm:true,appointments:true,team:true,reservations:false,feed:true,sales:true},
 IMMOBILIER:{crm:true,appointments:true,team:true,reservations:false,feed:true,sales:true},
 COMMERCE:{crm:false,appointments:false,team:false,reservations:false,feed:true,sales:true},
 VACANCES:{crm:false,appointments:false,team:false,reservations:true,feed:true,sales:true},
 SERVICES:{crm:true,appointments:false,team:false,reservations:false,feed:false,sales:true},
 GENERAL:{crm:false,appointments:false,team:false,reservations:false,feed:true,sales:true},
};
export function professionalSectorFeatures(sector:ProfessionalSector){return SECTOR_FEATURES[sector]}
export function normalizeProfessionalSector(input?:string|null,nafCode?:string|null):ProfessionalSector{
 const value=String(input??"").trim().toLowerCase().replace(/_/g,"-");
 if(["automobile","auto","garage","vehicule","vehicules"].includes(value))return"AUTOMOBILE";
 if(["immobilier","real-estate","realestate"].includes(value))return"IMMOBILIER";
 if(["high-tech","electronique","electronics","commerce","occasion","retail","mode","maison","jardin"].includes(value))return"COMMERCE";
 if(["vacances","hotel","hotellerie","tourisme"].includes(value))return"VACANCES";
 if(["services","service","emploi"].includes(value))return"SERVICES";
 const naf=String(nafCode??"").replace(/\s/g,"").toUpperCase();
 if(naf.startsWith("68"))return"IMMOBILIER";
 if(naf.startsWith("45"))return"AUTOMOBILE";
 if(naf.startsWith("55")||naf.startsWith("79"))return"VACANCES";
 if(naf.startsWith("47")||naf.startsWith("46"))return"COMMERCE";
 return"GENERAL";
}

const ROLE_PERMISSIONS:Record<ProRole,ProPermission[]>={
  OWNER:["DASHBOARD","CRM","APPOINTMENTS","ANALYTICS","LISTINGS","IMPORT","TEAM_VIEW","TEAM_MANAGE","BUSINESS","BILLING"],
  MANAGER:["DASHBOARD","CRM","APPOINTMENTS","ANALYTICS","LISTINGS","IMPORT","TEAM_VIEW","BUSINESS"],
  SALES:["DASHBOARD","CRM","APPOINTMENTS","ANALYTICS"],
  CATALOG:["DASHBOARD","ANALYTICS","LISTINGS","IMPORT"],
};

const leadStages=["NEW","CONTACTED","APPOINTMENT","NEGOTIATION","WON","LOST"] as const;
const appointmentStatuses=["REQUESTED","CONFIRMED","COMPLETED","CANCELED","NO_SHOW"] as const;
const appointmentTypes=["VISIT","TEST_DRIVE","CALL","VIDEO","OTHER"] as const;
const teamRoles=["MANAGER","SALES","CATALOG"] as const;
let schemaPromise:Promise<void>|null=null;
const sha256=(value:string)=>createHash("sha256").update(value).digest("hex");

export function ensureProSuiteSchema(){
 if(schemaPromise)return schemaPromise;
 schemaPromise=(async()=>{
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProTeamMember" (
    "id" TEXT PRIMARY KEY,"ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"userId" TEXT NULL REFERENCES "User"("id") ON DELETE SET NULL,
    "email" TEXT NOT NULL,"displayName" TEXT NULL,"role" TEXT NOT NULL DEFAULT 'SALES',"status" TEXT NOT NULL DEFAULT 'PENDING',"inviteTokenHash" TEXT NULL UNIQUE,
    "invitedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"acceptedAt" TIMESTAMPTZ NULL,"lastActiveAt" TIMESTAMPTZ NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("ownerUserId","email")
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProTeamMember_user_status_idx" ON "ProTeamMember"("userId","status")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProTeamMember_owner_status_idx" ON "ProTeamMember"("ownerUserId","status")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProLead" (
    "id" TEXT PRIMARY KEY,"ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"conversationId" TEXT NULL REFERENCES "Conversation"("id") ON DELETE SET NULL,
    "listingId" TEXT NULL REFERENCES "Listing"("id") ON DELETE SET NULL,"contactUserId" TEXT NULL REFERENCES "User"("id") ON DELETE SET NULL,
    "name" TEXT NULL,"email" TEXT NULL,"phone" TEXT NULL,"stage" TEXT NOT NULL DEFAULT 'NEW',"source" TEXT NOT NULL DEFAULT 'MESSAGE',
    "assignedMemberId" TEXT NULL REFERENCES "ProTeamMember"("id") ON DELETE SET NULL,"note" TEXT NULL,"lastActivityAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("ownerUserId","conversationId")
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProLead_owner_stage_idx" ON "ProLead"("ownerUserId","stage","lastActivityAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProLead_owner_contact_idx" ON "ProLead"("ownerUserId","contactUserId")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProAppointment" (
    "id" TEXT PRIMARY KEY,"ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"listingId" TEXT NULL REFERENCES "Listing"("id") ON DELETE SET NULL,
    "conversationId" TEXT NULL REFERENCES "Conversation"("id") ON DELETE SET NULL,"leadId" TEXT NULL REFERENCES "ProLead"("id") ON DELETE SET NULL,
    "customerUserId" TEXT NULL REFERENCES "User"("id") ON DELETE SET NULL,"customerName" TEXT NULL,"customerEmail" TEXT NULL,"customerPhone" TEXT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',"startAt" TIMESTAMPTZ NOT NULL,"endAt" TIMESTAMPTZ NOT NULL,"status" TEXT NOT NULL DEFAULT 'REQUESTED',"notes" TEXT NULL,
    "assignedMemberId" TEXT NULL REFERENCES "ProTeamMember"("id") ON DELETE SET NULL,"createdByUserId" TEXT NULL REFERENCES "User"("id") ON DELETE SET NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProAppointment_owner_start_idx" ON "ProAppointment"("ownerUserId","startAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProAppointment_listing_start_idx" ON "ProAppointment"("listingId","startAt")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProfessionalFeedItem" (
    "id" TEXT PRIMARY KEY,"ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"externalId" TEXT NOT NULL,"listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE,
    "sourceType" TEXT NOT NULL DEFAULT 'API',"lastSyncKey" TEXT NULL,"lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("ownerUserId","externalId")
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProfessionalFeedItem_owner_seen_idx" ON "ProfessionalFeedItem"("ownerUserId","lastSeenAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProfessionalProfileSettings" ("ownerUserId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,"sector" TEXT NOT NULL DEFAULT 'GENERAL',"source" TEXT NOT NULL DEFAULT 'INFERRED',"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 })().catch(error=>{schemaPromise=null;throw error});
 return schemaPromise;
}

export async function setProfessionalSector(ownerUserId:string,input?:string|null,source="MANUAL",nafCode?:string|null){
 await ensureProSuiteSchema();const sector=normalizeProfessionalSector(input,nafCode);
 await prisma.$executeRawUnsafe(`INSERT INTO "ProfessionalProfileSettings" ("ownerUserId","sector","source") VALUES ($1,$2,$3) ON CONFLICT ("ownerUserId") DO UPDATE SET "sector"=EXCLUDED."sector","source"=EXCLUDED."source","updatedAt"=CURRENT_TIMESTAMP`,ownerUserId,sector,source);return sector;
}
export async function getProfessionalSector(ownerUserId:string):Promise<ProfessionalSector>{
 await ensureProSuiteSchema();const saved=await prisma.$queryRawUnsafe<Array<{sector:string}>>(`SELECT "sector" FROM "ProfessionalProfileSettings" WHERE "ownerUserId"=$1 LIMIT 1`,ownerUserId);const valid=["AUTOMOBILE","IMMOBILIER","COMMERCE","VACANCES","SERVICES","GENERAL"] as const;if(saved[0]&&valid.includes(saved[0].sector as any))return saved[0].sector as ProfessionalSector;
 const business=await prisma.businessProfile.findUnique({where:{userId:ownerUserId},select:{nafCode:true}});let sector=normalizeProfessionalSector(null,business?.nafCode);
 if(sector==="GENERAL"){const rows=await prisma.$queryRawUnsafe<Array<{domain:string;count:bigint}>>(`SELECT c."domain"::text AS domain,COUNT(*)::bigint AS count FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId" WHERE l."sellerId"=$1 GROUP BY c."domain"`,ownerUserId).catch(()=>[]);const map=new Map(rows.map(r=>[r.domain,Number(r.count)]));if((map.get("REAL_ESTATE")??0)>0)sector="IMMOBILIER";else if((map.get("VEHICLE")??0)>0)sector="AUTOMOBILE";else if((map.get("VACATION")??0)>0)sector="VACANCES";else if(rows.length)sector="COMMERCE";}
 await setProfessionalSector(ownerUserId,sector,"INFERRED",business?.nafCode);return sector;
}

export async function resolveProfessionalContext(userId:string):Promise<ProfessionalAccessContext|null>{
 await ensureProSuiteSchema();
 const membership=await prisma.$queryRawUnsafe<Array<{ownerUserId:string;role:string}>>(`SELECT "ownerUserId","role" FROM "ProTeamMember" WHERE "userId"=$1 AND "status"='ACTIVE' ORDER BY "acceptedAt" DESC NULLS LAST LIMIT 1`,userId);
 if(membership[0]){
  const role=(teamRoles.includes(membership[0].role as any)?membership[0].role:"SALES") as ProRole;const sector=await getProfessionalSector(membership[0].ownerUserId);
  return{actorUserId:userId,ownerUserId:membership[0].ownerUserId,role,isOwner:false,permissions:ROLE_PERMISSIONS[role],sector,features:professionalSectorFeatures(sector)};
 }
 const owner=await prisma.user.findUnique({where:{id:userId},select:{kind:true}});
 if(owner?.kind!=="PROFESSIONNEL")return null;const sector=await getProfessionalSector(userId);
 return{actorUserId:userId,ownerUserId:userId,role:"OWNER",isOwner:true,permissions:ROLE_PERMISSIONS.OWNER,sector,features:professionalSectorFeatures(sector)};
}

export async function requireProfessionalContext(request:FastifyRequest,reply:FastifyReply,permission?:ProPermission){
 const user=await requireListingUser(request,reply);if(!user)return null;
 const ctx=await resolveProfessionalContext(user.id);
 if(!ctx){reply.code(403).send({error:"professional_account_required",upgradeUrl:"/professionnels"});return null}
 if(permission&&!ctx.permissions.includes(permission)){reply.code(403).send({error:"professional_permission_required",permission,role:ctx.role});return null}
 const sectorFeature=permission==="CRM"?"crm":permission==="APPOINTMENTS"?"appointments":permission==="TEAM_VIEW"||permission==="TEAM_MANAGE"?"team":null;if(sectorFeature&&!ctx.features[sectorFeature]){reply.code(403).send({error:"professional_feature_not_available",feature:sectorFeature,sector:ctx.sector});return null}
 if(!ctx.isOwner)await prisma.$executeRawUnsafe(`UPDATE "ProTeamMember" SET "lastActiveAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "ownerUserId"=$2 AND "status"='ACTIVE'`,ctx.actorUserId,ctx.ownerUserId).catch(()=>undefined);
 return{user,ctx};
}

async function detectSector(ownerUserId:string){return getProfessionalSector(ownerUserId)}

async function syncConversationLeads(ownerUserId:string){
 const rows=await prisma.$queryRawUnsafe<Array<{conversationId:string;listingId:string;contactUserId:string;name:string|null;email:string|null;phone:string|null;lastActivityAt:Date}>>(`
  SELECT c."id" AS "conversationId",c."listingId",c."buyerId" AS "contactUserId",
    COALESCE(p."displayName",NULLIF(TRIM(CONCAT_WS(' ',p."firstName",p."lastName")),''),u."email") AS name,u."email",p."phone",
    COALESCE(c."lastMessageAt",c."createdAt") AS "lastActivityAt"
  FROM "Conversation" c JOIN "User" u ON u."id"=c."buyerId" LEFT JOIN "UserProfile" p ON p."userId"=u."id"
  WHERE c."sellerId"=$1 ORDER BY COALESCE(c."lastMessageAt",c."createdAt") DESC LIMIT 500`,ownerUserId);
 for(const row of rows){
  await prisma.$executeRawUnsafe(`INSERT INTO "ProLead" ("id","ownerUserId","conversationId","listingId","contactUserId","name","email","phone","stage","source","lastActivityAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NEW','MESSAGE',$9)
   ON CONFLICT ("ownerUserId","conversationId") DO UPDATE SET "listingId"=EXCLUDED."listingId","contactUserId"=EXCLUDED."contactUserId","name"=COALESCE(EXCLUDED."name","ProLead"."name"),"email"=COALESCE(EXCLUDED."email","ProLead"."email"),"phone"=COALESCE(EXCLUDED."phone","ProLead"."phone"),"lastActivityAt"=GREATEST("ProLead"."lastActivityAt",EXCLUDED."lastActivityAt"),"updatedAt"=CURRENT_TIMESTAMP`,randomUUID(),ownerUserId,row.conversationId,row.listingId,row.contactUserId,row.name,row.email,row.phone,row.lastActivityAt);
 }
}

async function sendTeamInvite(email:string,displayName:string|null,token:string,companyName:string){
 const url=`https://petitannonces.fr/invitation-pro?token=${encodeURIComponent(token)}`;
 const subject=`Invitation à rejoindre ${companyName} sur Petit Annonces`;
 const text=`Bonjour${displayName?` ${displayName}`:""},\n\n${companyName} vous invite à rejoindre son espace professionnel Petit Annonces.\n\nAccepter l'invitation : ${url}\n\nConnectez-vous ou créez un compte avec cette adresse e-mail, puis acceptez l'invitation.`;
 const html=`<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f6f5fb;padding:24px"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fff;border-radius:18px"><tr><td style="padding:28px"><h1 style="font-size:22px;color:#24163d">Rejoignez ${companyName}</h1><p style="font-size:15px;line-height:1.6;color:#494052">${companyName} vous invite à rejoindre son espace professionnel Petit Annonces.</p><p><a href="${url}" style="display:inline-block;padding:13px 18px;background:#5b4cf0;color:#fff;text-decoration:none;border-radius:12px;font-weight:700">Accepter l'invitation</a></p><p style="font-size:12px;color:#777">Connectez-vous ou créez un compte avec l'adresse ${email}.</p></td></tr></table></td></tr></table></body></html>`;
 try{const sent=await sendApplicationEmail({to:email,subject,text,html});return{sent:true,id:sent.providerMessageId,provider:sent.provider}}catch(error){return{sent:false,reason:error instanceof Error?error.message:"email_send_failed"}}
}

export async function registerProSuiteRoutes(app:FastifyInstance){
 await ensureProSuiteSchema();

 app.get("/pro/suite/overview",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"DASHBOARD");if(!auth)return;const{ctx}=auth;
  await syncConversationLeads(ctx.ownerUserId);
  const [sector,leadRows,appointmentRows,teamRows,feedRows]=await Promise.all([
   detectSector(ctx.ownerUserId),
   prisma.$queryRawUnsafe<Array<{stage:string;count:bigint}>>(`SELECT "stage",COUNT(*)::bigint AS count FROM "ProLead" WHERE "ownerUserId"=$1 GROUP BY "stage"`,ctx.ownerUserId),
   prisma.$queryRawUnsafe<Array<{upcoming:bigint;today:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "startAt">CURRENT_TIMESTAMP AND "status" IN ('REQUESTED','CONFIRMED'))::bigint AS upcoming,COUNT(*) FILTER (WHERE "startAt">=CURRENT_DATE AND "startAt"<CURRENT_DATE+INTERVAL '1 day' AND "status" IN ('REQUESTED','CONFIRMED'))::bigint AS today FROM "ProAppointment" WHERE "ownerUserId"=$1`,ctx.ownerUserId),
   prisma.$queryRawUnsafe<Array<{active:bigint;pending:bigint}>>(`SELECT COUNT(*) FILTER (WHERE "status"='ACTIVE')::bigint AS active,COUNT(*) FILTER (WHERE "status"='PENDING')::bigint AS pending FROM "ProTeamMember" WHERE "ownerUserId"=$1`,ctx.ownerUserId),
   prisma.$queryRawUnsafe<Array<{items:bigint;lastSeenAt:Date|null}>>(`SELECT COUNT(*)::bigint AS items,MAX("lastSeenAt") AS "lastSeenAt" FROM "ProfessionalFeedItem" WHERE "ownerUserId"=$1`,ctx.ownerUserId),
  ]);
  const leads=Object.fromEntries(leadStages.map(s=>[s,0])) as Record<string,number>;for(const r of leadRows)leads[r.stage]=Number(r.count);
  return reply.send({sector,features:professionalSectorFeatures(sector),access:ctx,leads,appointments:{upcoming:Number(appointmentRows[0]?.upcoming??0n),today:Number(appointmentRows[0]?.today??0n)},team:{active:Number(teamRows[0]?.active??0n),pending:Number(teamRows[0]?.pending??0n)},feed:{items:Number(feedRows[0]?.items??0n),lastSeenAt:feedRows[0]?.lastSeenAt??null}});
 });

 app.get("/pro/crm/leads",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"CRM");if(!auth)return;const{ctx}=auth;await syncConversationLeads(ctx.ownerUserId);
  const query=z.object({stage:z.enum(leadStages).optional(),q:z.string().trim().max(120).optional()}).safeParse(request.query);if(!query.success)return reply.code(400).send({error:"invalid_request"});
  const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT l.*,ls."title" AS "listingTitle",ls."slug" AS "listingSlug",tm."displayName" AS "assignedName" FROM "ProLead" l LEFT JOIN "Listing" ls ON ls."id"=l."listingId" LEFT JOIN "ProTeamMember" tm ON tm."id"=l."assignedMemberId" WHERE l."ownerUserId"=$1 AND ($2::text IS NULL OR l."stage"=$2) AND ($3::text IS NULL OR COALESCE(l."name",'') ILIKE '%'||$3||'%' OR COALESCE(l."email",'') ILIKE '%'||$3||'%' OR COALESCE(ls."title",'') ILIKE '%'||$3||'%') ORDER BY l."lastActivityAt" DESC LIMIT 300`,ctx.ownerUserId,query.data.stage??null,query.data.q??null);
  const counts=await prisma.$queryRawUnsafe<Array<{stage:string;count:bigint}>>(`SELECT "stage",COUNT(*)::bigint AS count FROM "ProLead" WHERE "ownerUserId"=$1 GROUP BY "stage"`,ctx.ownerUserId);
  return reply.send({leads:rows,counts:Object.fromEntries(counts.map(r=>[r.stage,Number(r.count)])),stages:leadStages});
 });

 app.post("/pro/crm/leads",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"CRM");if(!auth)return;const{ctx}=auth;
  const body=z.object({name:z.string().trim().min(1).max(160),email:z.string().trim().email().optional(),phone:z.string().trim().max(40).optional(),listingId:z.string().optional(),stage:z.enum(leadStages).default("NEW"),note:z.string().trim().max(5000).optional()}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});
  if(body.data.listingId){const listing=await prisma.listing.findFirst({where:{id:body.data.listingId,sellerId:ctx.ownerUserId},select:{id:true}});if(!listing)return reply.code(404).send({error:"listing_not_found"})}
  const id=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "ProLead" ("id","ownerUserId","listingId","name","email","phone","stage","source","note","lastActivityAt") VALUES ($1,$2,$3,$4,$5,$6,$7,'MANUAL',$8,CURRENT_TIMESTAMP)`,id,ctx.ownerUserId,body.data.listingId??null,body.data.name,body.data.email??null,body.data.phone??null,body.data.stage,body.data.note??null);
  return reply.code(201).send({id});
 });

 app.patch("/pro/crm/leads/:id",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"CRM");if(!auth)return;const{ctx}=auth;const params=z.object({id:z.string().min(1)}).safeParse(request.params);
  const body=z.object({stage:z.enum(leadStages).optional(),note:z.string().trim().max(5000).nullable().optional(),assignedMemberId:z.string().nullable().optional(),name:z.string().trim().min(1).max(160).optional(),email:z.string().trim().email().nullable().optional(),phone:z.string().trim().max(40).nullable().optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
  const lead=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ProLead" WHERE "id"=$1 AND "ownerUserId"=$2 LIMIT 1`,params.data.id,ctx.ownerUserId);if(!lead[0])return reply.code(404).send({error:"lead_not_found"});
  if(body.data.assignedMemberId){const member=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ProTeamMember" WHERE "id"=$1 AND "ownerUserId"=$2 AND "status"='ACTIVE' LIMIT 1`,body.data.assignedMemberId,ctx.ownerUserId);if(!member[0])return reply.code(404).send({error:"team_member_not_found"})}
  const current=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ProLead" WHERE "id"=$1 LIMIT 1`,params.data.id);const x=current[0];
  const next={stage:body.data.stage??x.stage,note:body.data.note===undefined?x.note:body.data.note,assignedMemberId:body.data.assignedMemberId===undefined?x.assignedMemberId:body.data.assignedMemberId,name:body.data.name??x.name,email:body.data.email===undefined?x.email:body.data.email,phone:body.data.phone===undefined?x.phone:body.data.phone};
  await prisma.$executeRawUnsafe(`UPDATE "ProLead" SET "stage"=$2,"note"=$3,"assignedMemberId"=$4,"name"=$5,"email"=$6,"phone"=$7,"lastActivityAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,params.data.id,next.stage,next.note,next.assignedMemberId,next.name,next.email,next.phone);
  return reply.send({updated:true});
 });

 app.get("/pro/team",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"TEAM_VIEW");if(!auth)return;const{ctx}=auth;
  const members=await prisma.$queryRawUnsafe<Array<any>>(`SELECT tm."id",tm."email",tm."displayName",tm."role",tm."status",tm."invitedAt",tm."acceptedAt",tm."lastActiveAt",tm."userId",p."avatarUrl" FROM "ProTeamMember" tm LEFT JOIN "UserProfile" p ON p."userId"=tm."userId" WHERE tm."ownerUserId"=$1 ORDER BY CASE tm."status" WHEN 'ACTIVE' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,tm."createdAt" ASC`,ctx.ownerUserId);
  return reply.send({members,role:ctx.role,isOwner:ctx.isOwner,roles:teamRoles});
 });

 app.post("/pro/team/invite",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"TEAM_MANAGE");if(!auth)return;const{ctx}=auth;
  const body=z.object({email:z.string().trim().toLowerCase().email(),displayName:z.string().trim().max(120).optional(),role:z.enum(teamRoles)}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});
  const owner=await prisma.user.findUnique({where:{id:ctx.ownerUserId},select:{email:true,business:{select:{tradeName:true,legalName:true}}}});if(!owner)return reply.code(404).send({error:"owner_not_found"});if(owner.email.toLowerCase()===body.data.email)return reply.code(409).send({error:"cannot_invite_owner"});
  const token=`pa_team_${randomBytes(32).toString("base64url")}`;const tokenHash=sha256(token);const id=randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO "ProTeamMember" ("id","ownerUserId","email","displayName","role","status","inviteTokenHash","invitedAt","acceptedAt","userId","updatedAt") VALUES ($1,$2,$3,$4,$5,'PENDING',$6,CURRENT_TIMESTAMP,NULL,NULL,CURRENT_TIMESTAMP) ON CONFLICT ("ownerUserId","email") DO UPDATE SET "displayName"=EXCLUDED."displayName","role"=EXCLUDED."role","status"='PENDING',"inviteTokenHash"=EXCLUDED."inviteTokenHash","invitedAt"=CURRENT_TIMESTAMP,"acceptedAt"=NULL,"userId"=NULL,"updatedAt"=CURRENT_TIMESTAMP`,id,ctx.ownerUserId,body.data.email,body.data.displayName??null,body.data.role,tokenHash);
  const company=owner.business?.tradeName??owner.business?.legalName??"Votre entreprise";const delivery=await sendTeamInvite(body.data.email,body.data.displayName??null,token,company);
  return reply.code(201).send({invited:true,delivery});
 });

 app.patch("/pro/team/:id",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"TEAM_MANAGE");if(!auth)return;const{ctx}=auth;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({role:z.enum(teamRoles).optional(),status:z.enum(["ACTIVE","REVOKED"]).optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
  const row=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ProTeamMember" WHERE "id"=$1 AND "ownerUserId"=$2 LIMIT 1`,params.data.id,ctx.ownerUserId);if(!row[0])return reply.code(404).send({error:"team_member_not_found"});
  await prisma.$executeRawUnsafe(`UPDATE "ProTeamMember" SET "role"=$2,"status"=$3,"inviteTokenHash"=CASE WHEN $3='REVOKED' THEN NULL ELSE "inviteTokenHash" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,params.data.id,body.data.role??row[0].role,body.data.status??row[0].status);
  return reply.send({updated:true});
 });

 app.get("/pro/team/invitation",async(request,reply)=>{
  await ensureProSuiteSchema();const query=z.object({token:z.string().min(20).max(200)}).safeParse(request.query);if(!query.success)return reply.code(400).send({error:"invalid_token"});
  const rows=await prisma.$queryRawUnsafe<Array<{email:string;displayName:string|null;role:string;companyName:string}>>(`SELECT tm."email",tm."displayName",tm."role",COALESCE(bp."tradeName",bp."legalName",'Entreprise') AS "companyName" FROM "ProTeamMember" tm JOIN "User" u ON u."id"=tm."ownerUserId" LEFT JOIN "BusinessProfile" bp ON bp."userId"=u."id" WHERE tm."inviteTokenHash"=$1 AND tm."status"='PENDING' LIMIT 1`,sha256(query.data.token));
  if(!rows[0])return reply.code(404).send({error:"invitation_not_found"});return reply.send({invitation:rows[0]});
 });

 app.post("/pro/team/accept",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;await ensureProSuiteSchema();const body=z.object({token:z.string().min(20).max(200)}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_token"});
  const rows=await prisma.$queryRawUnsafe<Array<{id:string;ownerUserId:string;email:string;status:string}>>(`SELECT "id","ownerUserId","email","status" FROM "ProTeamMember" WHERE "inviteTokenHash"=$1 AND "status"='PENDING' LIMIT 1`,sha256(body.data.token));const invite=rows[0];if(!invite)return reply.code(404).send({error:"invitation_not_found"});if(invite.email.toLowerCase()!==user.email.toLowerCase())return reply.code(409).send({error:"invitation_email_mismatch",email:invite.email});
  const ownerSector=await getProfessionalSector(invite.ownerUserId);if(!professionalSectorFeatures(ownerSector).team)return reply.code(403).send({error:"professional_feature_not_available",feature:"team",sector:ownerSector});const ownBusiness=await prisma.businessProfile.findUnique({where:{userId:user.id},select:{id:true}});if(ownBusiness&&user.id!==invite.ownerUserId)return reply.code(409).send({error:"professional_owner_cannot_join_team"});
  await prisma.$transaction(async tx=>{await tx.user.update({where:{id:user.id},data:{kind:"PROFESSIONNEL"}});await tx.$executeRawUnsafe(`UPDATE "ProTeamMember" SET "userId"=$2,"status"='ACTIVE',"acceptedAt"=CURRENT_TIMESTAMP,"inviteTokenHash"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,invite.id,user.id)});
  return reply.send({accepted:true,next:"/espace-pro"});
 });

 app.get("/pro/appointments",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"APPOINTMENTS");if(!auth)return;const{ctx}=auth;const query=z.object({from:z.string().datetime().optional(),to:z.string().datetime().optional(),status:z.enum(appointmentStatuses).optional()}).safeParse(request.query);if(!query.success)return reply.code(400).send({error:"invalid_request"});
  const from=query.data.from?new Date(query.data.from):new Date(Date.now()-7*86400000);const to=query.data.to?new Date(query.data.to):new Date(Date.now()+60*86400000);
  const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT a.*,l."title" AS "listingTitle",l."slug" AS "listingSlug",tm."displayName" AS "assignedName" FROM "ProAppointment" a LEFT JOIN "Listing" l ON l."id"=a."listingId" LEFT JOIN "ProTeamMember" tm ON tm."id"=a."assignedMemberId" WHERE a."ownerUserId"=$1 AND a."startAt">=$2 AND a."startAt"<$3 AND ($4::text IS NULL OR a."status"=$4) ORDER BY a."startAt" ASC LIMIT 500`,ctx.ownerUserId,from,to,query.data.status??null);
  return reply.send({appointments:rows,statuses:appointmentStatuses,types:appointmentTypes});
 });

 app.post("/pro/appointments",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"APPOINTMENTS");if(!auth)return;const{ctx}=auth;const body=z.object({listingId:z.string().optional(),leadId:z.string().optional(),customerName:z.string().trim().max(160).optional(),customerEmail:z.string().trim().email().optional(),customerPhone:z.string().trim().max(40).optional(),type:z.enum(appointmentTypes).default("OTHER"),startAt:z.string().datetime(),endAt:z.string().datetime(),notes:z.string().trim().max(4000).optional(),assignedMemberId:z.string().optional()}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});const startAt=new Date(body.data.startAt),endAt=new Date(body.data.endAt);if(endAt<=startAt||endAt.getTime()-startAt.getTime()>8*3600000)return reply.code(400).send({error:"invalid_time_range"});
  if(body.data.listingId){const listing=await prisma.listing.findFirst({where:{id:body.data.listingId,sellerId:ctx.ownerUserId},select:{id:true}});if(!listing)return reply.code(404).send({error:"listing_not_found"})}
  const id=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "ProAppointment" ("id","ownerUserId","listingId","leadId","customerName","customerEmail","customerPhone","type","startAt","endAt","status","notes","assignedMemberId","createdByUserId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONFIRMED',$11,$12,$13)`,id,ctx.ownerUserId,body.data.listingId??null,body.data.leadId??null,body.data.customerName??null,body.data.customerEmail??null,body.data.customerPhone??null,body.data.type,startAt,endAt,body.data.notes??null,body.data.assignedMemberId??null,ctx.actorUserId);
  if(body.data.leadId)await prisma.$executeRawUnsafe(`UPDATE "ProLead" SET "stage"='APPOINTMENT',"lastActivityAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "ownerUserId"=$2`,body.data.leadId,ctx.ownerUserId);
  return reply.code(201).send({id});
 });

 app.patch("/pro/appointments/:id",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"APPOINTMENTS");if(!auth)return;const{ctx}=auth;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({status:z.enum(appointmentStatuses).optional(),startAt:z.string().datetime().optional(),endAt:z.string().datetime().optional(),notes:z.string().trim().max(4000).nullable().optional(),assignedMemberId:z.string().nullable().optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ProAppointment" WHERE "id"=$1 AND "ownerUserId"=$2 LIMIT 1`,params.data.id,ctx.ownerUserId);const current=rows[0];if(!current)return reply.code(404).send({error:"appointment_not_found"});const startAt=body.data.startAt?new Date(body.data.startAt):current.startAt;const endAt=body.data.endAt?new Date(body.data.endAt):current.endAt;if(endAt<=startAt)return reply.code(400).send({error:"invalid_time_range"});const nextStatus=body.data.status??current.status;await prisma.$executeRawUnsafe(`UPDATE "ProAppointment" SET "status"=$2,"startAt"=$3,"endAt"=$4,"notes"=$5,"assignedMemberId"=$6,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,params.data.id,nextStatus,startAt,endAt,body.data.notes===undefined?current.notes:body.data.notes,body.data.assignedMemberId===undefined?current.assignedMemberId:body.data.assignedMemberId);if(current.customerUserId&&body.data.status&&body.data.status!==current.status){const state=nextStatus==="CONFIRMED"?"confirmé":nextStatus==="CANCELED"?"annulé":nextStatus==="COMPLETED"?"terminé":nextStatus==="NO_SHOW"?"mis à jour":null;if(state)void deliverUserEvent({userId:current.customerUserId,eventKind:"LISTING",notificationKind:"SYSTEM",title:`Rendez-vous ${state}`,body:`Votre rendez-vous du ${startAt.toLocaleString("fr-FR",{timeZone:"Europe/Paris"})} a été ${state}.`,actionUrl:"/notifications",metadata:{appointmentId:current.id,status:nextStatus,transactional:true},transactional:true,dedupeKey:`pro-appointment-status:${current.id}:${nextStatus}`}).catch(()=>undefined)}return reply.send({updated:true});
 });

 app.get("/pro/suite/analytics",async(request,reply)=>{
  const auth=await requireProfessionalContext(request,reply,"ANALYTICS");if(!auth)return;const{ctx}=auth;await syncConversationLeads(ctx.ownerUserId);const query=z.object({days:z.coerce.number().int().refine(v=>[7,30,90].includes(v)).default(30)}).safeParse(request.query);if(!query.success)return reply.code(400).send({error:"invalid_period"});const since=new Date(Date.now()-query.data.days*86400000);
  const [leadRows,appointmentRows,responseRows,sourceRows]=await Promise.all([
   prisma.$queryRawUnsafe<Array<{stage:string;count:bigint}>>(`SELECT "stage",COUNT(*)::bigint AS count FROM "ProLead" WHERE "ownerUserId"=$1 AND "createdAt">=$2 GROUP BY "stage"`,ctx.ownerUserId,since),
   prisma.$queryRawUnsafe<Array<{status:string;count:bigint}>>(`SELECT "status",COUNT(*)::bigint AS count FROM "ProAppointment" WHERE "ownerUserId"=$1 AND "createdAt">=$2 GROUP BY "status"`,ctx.ownerUserId,since),
   prisma.$queryRawUnsafe<Array<{averageMinutes:number|null}>>(`WITH x AS (SELECT c."id",MIN(m."createdAt") FILTER (WHERE m."senderId"=c."buyerId") AS buyer_first,MIN(m."createdAt") FILTER (WHERE m."senderId"=c."sellerId") AS seller_first FROM "Conversation" c LEFT JOIN "Message" m ON m."conversationId"=c."id" WHERE c."sellerId"=$1 AND c."createdAt">=$2 GROUP BY c."id") SELECT AVG(EXTRACT(EPOCH FROM (seller_first-buyer_first))/60.0)::float AS "averageMinutes" FROM x WHERE buyer_first IS NOT NULL AND seller_first IS NOT NULL AND seller_first>=buyer_first`,ctx.ownerUserId,since),
   prisma.$queryRawUnsafe<Array<{source:string;count:bigint}>>(`SELECT "source",COUNT(*)::bigint AS count FROM "ProLead" WHERE "ownerUserId"=$1 AND "createdAt">=$2 GROUP BY "source" ORDER BY count DESC`,ctx.ownerUserId,since),
  ]);
  const leads=Object.fromEntries(leadStages.map(s=>[s,0])) as Record<string,number>;for(const r of leadRows)leads[r.stage]=Number(r.count);const total=Object.values(leads).reduce((a,b)=>a+b,0);const won=leads.WON??0;const appts=Object.fromEntries(appointmentRows.map(r=>[r.status,Number(r.count)]));
  return reply.send({periodDays:query.data.days,leadFunnel:leads,totalLeads:total,wonLeads:won,leadConversionRate:total?Math.round(won/total*1000)/10:0,appointments:appts,averageFirstResponseMinutes:responseRows[0]?.averageMinutes??null,sources:sourceRows.map(r=>({source:r.source,count:Number(r.count)}))});
 });

 app.get("/listings/:id/appointments/availability",async(request,reply)=>{
  await ensureProSuiteSchema();const params=z.object({id:z.string().min(1)}).safeParse(request.params);const query=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).safeParse(request.query);if(!params.success||!query.success)return reply.code(400).send({error:"invalid_request"});const listing=await prisma.listing.findFirst({where:{id:params.data.id,status:"PUBLISHED",seller:{kind:"PROFESSIONNEL"}},select:{id:true,sellerId:true,category:{select:{domain:true}}}});if(!listing)return reply.code(404).send({error:"listing_not_found"});const sellerSector=await getProfessionalSector(listing.sellerId);const appointmentAllowed=(sellerSector==="AUTOMOBILE"&&listing.category.domain==="VEHICLE")||(sellerSector==="IMMOBILIER"&&listing.category.domain==="REAL_ESTATE");if(!appointmentAllowed)return reply.code(404).send({error:"appointments_not_available"});const dayStart=new Date(`${query.data.date}T00:00:00+02:00`);const dayEnd=new Date(dayStart.getTime()+86400000);const busy=await prisma.$queryRawUnsafe<Array<{startAt:Date;endAt:Date}>>(`SELECT "startAt","endAt" FROM "ProAppointment" WHERE "ownerUserId"=$1 AND "startAt">=$2 AND "startAt"<$3 AND "status" IN ('REQUESTED','CONFIRMED') ORDER BY "startAt"`,listing.sellerId,dayStart,dayEnd);return reply.send({busy,type:listing.category.domain==="VEHICLE"?"TEST_DRIVE":listing.category.domain==="REAL_ESTATE"?"VISIT":"CALL"});
 });

 app.post("/listings/:id/appointments",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;await ensureProSuiteSchema();const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({startAt:z.string().datetime(),endAt:z.string().datetime(),notes:z.string().trim().max(1000).optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const listing=await prisma.listing.findFirst({where:{id:params.data.id,status:"PUBLISHED",seller:{kind:"PROFESSIONNEL"}},select:{id:true,sellerId:true,category:{select:{domain:true}},title:true}});if(!listing)return reply.code(404).send({error:"listing_not_found"});const sellerSector=await getProfessionalSector(listing.sellerId);const appointmentAllowed=(sellerSector==="AUTOMOBILE"&&listing.category.domain==="VEHICLE")||(sellerSector==="IMMOBILIER"&&listing.category.domain==="REAL_ESTATE");if(!appointmentAllowed)return reply.code(404).send({error:"appointments_not_available"});if(listing.sellerId===user.id)return reply.code(409).send({error:"cannot_book_own_listing"});const startAt=new Date(body.data.startAt),endAt=new Date(body.data.endAt);if(startAt.getTime()<Date.now()+15*60000||endAt<=startAt||endAt.getTime()-startAt.getTime()>4*3600000)return reply.code(400).send({error:"invalid_time_range"});const conflict=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ProAppointment" WHERE "ownerUserId"=$1 AND "status" IN ('REQUESTED','CONFIRMED') AND "startAt"<$3 AND "endAt">$2 LIMIT 1`,listing.sellerId,startAt,endAt);if(conflict[0])return reply.code(409).send({error:"slot_unavailable"});const profile=await prisma.userProfile.findUnique({where:{userId:user.id},select:{displayName:true,firstName:true,lastName:true,phone:true}});const profileName=[profile?.firstName,profile?.lastName].filter(Boolean).join(" ").trim();const customerName=profile?.displayName??(profileName||user.email);const leadRows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ProLead" WHERE "ownerUserId"=$1 AND "contactUserId"=$2 AND "listingId"=$3 ORDER BY "createdAt" DESC LIMIT 1`,listing.sellerId,user.id,listing.id);let leadId=leadRows[0]?.id;if(!leadId){leadId=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "ProLead" ("id","ownerUserId","listingId","contactUserId","name","email","phone","stage","source","lastActivityAt") VALUES ($1,$2,$3,$4,$5,$6,$7,'APPOINTMENT','APPOINTMENT',CURRENT_TIMESTAMP)`,leadId,listing.sellerId,listing.id,user.id,customerName,user.email,profile?.phone??null)}else await prisma.$executeRawUnsafe(`UPDATE "ProLead" SET "stage"='APPOINTMENT',"lastActivityAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,leadId);const id=randomUUID();const type=listing.category.domain==="VEHICLE"?"TEST_DRIVE":listing.category.domain==="REAL_ESTATE"?"VISIT":"CALL";await prisma.$executeRawUnsafe(`INSERT INTO "ProAppointment" ("id","ownerUserId","listingId","leadId","customerUserId","customerName","customerEmail","customerPhone","type","startAt","endAt","status","notes","createdByUserId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'REQUESTED',$12,$5)`,id,listing.sellerId,listing.id,leadId,user.id,customerName,user.email,profile?.phone??null,type,startAt,endAt,body.data.notes??null);void deliverUserEvent({userId:listing.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:type==="TEST_DRIVE"?"Nouvelle demande d’essai":"Nouvelle demande de rendez-vous",body:`${customerName} souhaite ${type==="TEST_DRIVE"?"essayer":"voir"} « ${listing.title??"votre annonce"} » le ${startAt.toLocaleString("fr-FR",{timeZone:"Europe/Paris"})}.`,actionUrl:"/espace-pro/rendez-vous",metadata:{appointmentId:id,listingId:listing.id,type,transactional:true},transactional:true,dedupeKey:`pro-appointment:${id}`}).catch(()=>undefined);return reply.code(201).send({id,status:"REQUESTED",type,listingTitle:listing.title});
 });
}