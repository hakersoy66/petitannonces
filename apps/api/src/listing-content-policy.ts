import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";
import { deleteStoredObject } from "./storage.js";
import { recordUserRiskEvent } from "./risk-engine.js";

const SESSION_COOKIE="pa_session";
const MODERATION_ROLES=["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","COMPLIANCE"] as const;
const DEFAULT_FORBIDDEN_TERMS=[
  "retour d'affection","retour affectif","retour amoureux","rituel d'amour","envoûtement amoureux","envoutement amoureux",
  "reconquérir son ex","reconquerir son ex","faire revenir ton ex","faire revenir son ex","attachement amoureux","rituel chap chap",
  "western union","mandat cash","moneygram","coupon pcs","recharge pcs","transcash","paiement hors plateforme","crypto uniquement","telegram uniquement",
];

type PolicySignal={code:"FORBIDDEN_TERM"|"CONTACT_EMAIL"|"CONTACT_PHONE"|"MANUAL_BLOCK";field:"title"|"description"|"both"|"account";term?:string};
type HoldRow={id:string;userId:string;ipHash:string;status:string;reasonCode:string;signals:PolicySignal[];attemptTitle:string|null;attemptDescription:string|null;attemptListingId:string|null;attemptCount:number;moderationCaseId:string|null;createdAt:Date;updatedAt:Date;reviewedAt:Date|null;reviewNote:string|null};

function sha256(value:string){return createHash("sha256").update(value).digest("hex")}
function normalize(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr-FR").replace(/[^a-z0-9+@.]+/g," ").replace(/\s+/g," ").trim()}
function hashIpValue(value:string){return sha256(`${process.env.IP_HASH_SALT??"petitannonces"}:${value.trim()}`)}
function ipHash(request:FastifyRequest){return hashIpValue(request.ip||"unknown")}
function emailIn(value:string){return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)}
function phoneIn(value:string){
  const international=/(?:\+|00)\s*\d{1,3}(?:[\s().-]*\d){7,12}\b/;
  const french=/\b0[1-9](?:[\s.-]*\d{2}){4}\b/;
  const labelled=/(?:t[ée]l(?:[ée]phone)?|phone|whatsapp|contact)\s*[:=.-]?\s*(?:\+|00)?\s*\d(?:[\s().-]*\d){7,14}/i;
  return international.test(value)||french.test(value)||labelled.test(value);
}

let schemaPromise:Promise<void>|null=null;
async function initializeListingContentPolicySchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingForbiddenTerm" ("id" TEXT PRIMARY KEY,"term" TEXT NOT NULL,"normalizedTerm" TEXT NOT NULL UNIQUE,"enabled" BOOLEAN NOT NULL DEFAULT TRUE,"createdByUserId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingForbiddenTerm_enabled_idx" ON "ListingForbiddenTerm"("enabled","updatedAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingSpamHold" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"ipHash" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'PENDING',"reasonCode" TEXT NOT NULL DEFAULT 'LISTING_CONTENT_POLICY',"signals" JSONB NOT NULL DEFAULT '[]'::jsonb,"attemptTitle" TEXT,"attemptDescription" TEXT,"attemptListingId" TEXT,"attemptCount" INTEGER NOT NULL DEFAULT 1,"moderationCaseId" TEXT,"reviewedByUserId" TEXT,"reviewedAt" TIMESTAMP(3),"reviewNote" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "ListingSpamHold_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,CONSTRAINT "ListingSpamHold_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED')))`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingSpamHold_ip_status_idx" ON "ListingSpamHold"("ipHash","status","updatedAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingSpamHold_user_status_idx" ON "ListingSpamHold"("userId","status","updatedAt" DESC)`);
  for(const term of DEFAULT_FORBIDDEN_TERMS){const normalizedTerm=normalize(term);await prisma.$executeRawUnsafe(`INSERT INTO "ListingForbiddenTerm" ("id","term","normalizedTerm") VALUES ($1,$2,$3) ON CONFLICT ("normalizedTerm") DO NOTHING`,randomUUID(),term,normalizedTerm)}
}
export function ensureListingContentPolicySchema(){
  if(schemaPromise)return schemaPromise;
  schemaPromise=initializeListingContentPolicySchema().catch(error=>{schemaPromise=null;throw error});
  return schemaPromise;
}

function bearerToken(request:FastifyRequest){const value=request.headers.authorization;if(typeof value!=="string")return null;const match=/^Bearer\s+([A-Za-z0-9_-]{20,300})$/i.exec(value.trim());return match?.[1]??null}
async function sessionIdentity(request:FastifyRequest){
  const token=request.cookies[SESSION_COOKIE]??bearerToken(request);if(!token)return null;
  return prisma.session.findUnique({where:{tokenHash:sha256(token)},select:{userId:true,revokedAt:true,expiresAt:true,user:{select:{status:true,roles:{select:{role:true}}}}}}).then(s=>s&&!s.revokedAt&&s.expiresAt>new Date()&&s.user.status==="ACTIVE"?s:null);
}

export async function scanListingContent(title:string|null|undefined,description:string|null|undefined){
  await ensureListingContentPolicySchema();
  const titleText=String(title??"");const descriptionText=String(description??"");const signals:PolicySignal[]=[];
  const contactField=(fn:(v:string)=>boolean)=>fn(titleText)&&fn(descriptionText)?"both":fn(titleText)?"title":fn(descriptionText)?"description":null;
  const emailField=contactField(emailIn);if(emailField)signals.push({code:"CONTACT_EMAIL",field:emailField});
  const phoneField=contactField(phoneIn);if(phoneField)signals.push({code:"CONTACT_PHONE",field:phoneField});
  const titleNorm=normalize(titleText);const descriptionNorm=normalize(descriptionText);
  const terms=await prisma.$queryRawUnsafe<Array<{term:string;normalizedTerm:string}>>(`SELECT "term","normalizedTerm" FROM "ListingForbiddenTerm" WHERE "enabled"=TRUE ORDER BY length("normalizedTerm") DESC`);
  for(const term of terms){const inTitle=titleNorm.includes(term.normalizedTerm);const inDescription=descriptionNorm.includes(term.normalizedTerm);if(inTitle||inDescription)signals.push({code:"FORBIDDEN_TERM",field:inTitle&&inDescription?"both":inTitle?"title":"description",term:term.term})}
  return{blocked:signals.length>0,signals};
}

export async function getBlockingSpamHold(request:FastifyRequest,userId?:string|null){
  await ensureListingContentPolicySchema();
  const hash=ipHash(request);
  const rows=await prisma.$queryRawUnsafe<HoldRow[]>(`SELECT * FROM "ListingSpamHold" WHERE "status" IN ('PENDING','REJECTED') AND (($1::text IS NOT NULL AND "userId"=$1) OR "ipHash"=$2) ORDER BY "updatedAt" DESC LIMIT 1`,userId??null,hash);
  return rows[0]??null;
}

async function ensureUserModerationCase(userId:string){
  const existing=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ModerationCase" WHERE "targetType"='USER' AND "targetId"=$1 AND "status" NOT IN ('RESOLVED','CLOSED') ORDER BY "createdAt" DESC LIMIT 1`,userId);
  if(existing[0]){await prisma.$executeRawUnsafe(`UPDATE "ModerationCase" SET "priority"=100,"riskScore"=100,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,existing[0].id);return existing[0].id}
  const id=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "ModerationCase" ("id","targetType","targetId","priority","riskScore","automatedDecision") VALUES ($1,'USER',$2,100,100,FALSE)`,id,userId);return id;
}

export async function rejectListingAttemptForPolicy(args:{request:FastifyRequest;userId:string;listingId:string}){
  await ensureListingContentPolicySchema();
  const listing=await prisma.listing.findFirst({where:{id:args.listingId,sellerId:args.userId,status:"DRAFT"},select:{id:true,title:true,description:true}});if(!listing)return null;
  const scan=await scanListingContent(listing.title,listing.description);if(!scan.blocked)return null;
  const hash=ipHash(args.request);const media=await prisma.$queryRawUnsafe<Array<{objectKey:string}>>(`SELECT "objectKey" FROM "ListingMedia" WHERE "listingId"=$1`,listing.id).catch(()=>[]);
  const caseId=await ensureUserModerationCase(args.userId);
  const existing=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ListingSpamHold" WHERE "userId"=$1 AND "status" IN ('PENDING','REJECTED') ORDER BY "updatedAt" DESC LIMIT 1`,args.userId);
  const holdId=existing[0]?.id??randomUUID();
  await prisma.$transaction(async tx=>{
    if(existing[0])await tx.$executeRawUnsafe(`UPDATE "ListingSpamHold" SET "ipHash"=$2,"status"='PENDING',"signals"=$3::jsonb,"attemptTitle"=$4,"attemptDescription"=$5,"attemptListingId"=$6,"attemptCount"="attemptCount"+1,"moderationCaseId"=$7,"reviewedByUserId"=NULL,"reviewedAt"=NULL,"reviewNote"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,holdId,hash,JSON.stringify(scan.signals),listing.title,listing.description?.slice(0,4000)??null,listing.id,caseId);
    else await tx.$executeRawUnsafe(`INSERT INTO "ListingSpamHold" ("id","userId","ipHash","status","reasonCode","signals","attemptTitle","attemptDescription","attemptListingId","moderationCaseId") VALUES ($1,$2,$3,'PENDING','LISTING_CONTENT_POLICY',$4::jsonb,$5,$6,$7,$8)`,holdId,args.userId,hash,JSON.stringify(scan.signals),listing.title,listing.description?.slice(0,4000)??null,listing.id,caseId);
    await tx.$executeRawUnsafe(`UPDATE "ModerationCase" SET "status"='CLOSED',"decisionReasonCode"='CONTENT_POLICY_BLOCK',"decisionStatement"='Annonce supprimée automatiquement avant publication pour contenu interdit ou coordonnées directes.',"updatedAt"=CURRENT_TIMESTAMP WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('RESOLVED','CLOSED')`,listing.id);
    await tx.$executeRawUnsafe(`DELETE FROM "ListingImportLog" WHERE "listingId"=$1`,listing.id).catch(()=>undefined);
    await tx.$executeRawUnsafe(`DELETE FROM "FraudRiskAssessment" WHERE "subjectType"='LISTING' AND "subjectId"=$1`,listing.id).catch(()=>undefined);
    await tx.listing.deleteMany({where:{id:listing.id,sellerId:args.userId,status:"DRAFT"}});
  });
  for(const item of media)await deleteStoredObject(item.objectKey).catch(()=>undefined);
  await recordUserRiskEvent({userId:args.userId,eventType:"LISTING_CONTENT_SPAM",weight:80,metadata:{holdId,signals:scan.signals.map(s=>({code:s.code,field:s.field})),listingDiscarded:true}}).catch(()=>undefined);
  return{holdId,caseId,signals:scan.signals.map(s=>({code:s.code,field:s.field})),redirect:"/compte-suspendu"};
}

export async function registerListingContentPolicyRoutes(app:FastifyInstance){
  await ensureListingContentPolicySchema();
  app.get("/security/access-state",async(request,reply)=>{
    const session=await sessionIdentity(request);const roles=session?.user.roles.map(r=>r.role)??[];
    if(roles.some(role=>MODERATION_ROLES.includes(role as any)))return reply.send({blocked:false,adminBypass:true});
    const hold=await getBlockingSpamHold(request,session?.userId??null);if(!hold)return reply.send({blocked:false});
    const reasons=[...new Set((hold.signals??[]).map(signal=>signal.code))];
    return reply.send({blocked:true,status:hold.status,reasonCode:hold.reasonCode,reasons,createdAt:hold.createdAt,reviewPending:hold.status==="PENDING",redirect:"/compte-suspendu"});
  });

  app.get("/admin/moderation/content-policy",{preHandler:requireAdminRoles([...MODERATION_ROLES])},async(_request,reply)=>{
    const [terms,holds]=await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","term","enabled","createdAt","updatedAt" FROM "ListingForbiddenTerm" ORDER BY "enabled" DESC,"term" ASC`),
      prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT h.*,u."email",COALESCE(p."displayName",p."firstName",u."email") AS "userName" FROM "ListingSpamHold" h JOIN "User" u ON u."id"=h."userId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE h."status" IN ('PENDING','REJECTED') ORDER BY CASE h."status" WHEN 'PENDING' THEN 0 ELSE 1 END,h."updatedAt" DESC LIMIT 100`),
    ]);
    return reply.send({terms,holds,summary:{activeTerms:terms.filter(x=>x.enabled===true).length,pending:holds.filter(x=>x.status==="PENDING").length,blocked:holds.length}});
  });

  app.post("/admin/moderation/content-policy/terms",{preHandler:requireAdminRoles([...MODERATION_ROLES])},async(request,reply)=>{
    const body=z.object({term:z.string().trim().min(3).max(120)}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request"});
    const normalizedTerm=normalize(body.data.term);const id=randomUUID();
    try{await prisma.$executeRawUnsafe(`INSERT INTO "ListingForbiddenTerm" ("id","term","normalizedTerm") VALUES ($1,$2,$3)`,id,body.data.term,normalizedTerm)}catch{return reply.code(409).send({error:"term_already_exists"})}
    return reply.code(201).send({term:{id,term:body.data.term,enabled:true}});
  });

  app.patch("/admin/moderation/content-policy/terms/:id",{preHandler:requireAdminRoles([...MODERATION_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({enabled:z.boolean()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "ListingForbiddenTerm" SET "enabled"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 RETURNING "id"`,params.data.id,body.data.enabled);if(!rows[0])return reply.code(404).send({error:"term_not_found"});return reply.send({saved:true});
  });

  app.delete("/admin/moderation/content-policy/terms/:id",{preHandler:requireAdminRoles([...MODERATION_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});await prisma.$executeRawUnsafe(`DELETE FROM "ListingForbiddenTerm" WHERE "id"=$1`,params.data.id);return reply.code(204).send();
  });

  app.post("/admin/moderation/content-policy/holds/manual",{preHandler:requireAdminRoles([...MODERATION_ROLES])},async(request,reply)=>{
    const body=z.object({email:z.string().trim().email().max(320),ip:z.string().trim().max(64).optional().or(z.literal("")),note:z.string().trim().min(3).max(1000)}).safeParse(request.body);
    if(!body.success)return reply.code(400).send({error:"invalid_request"});
    if(body.data.ip&&isIP(body.data.ip)===0)return reply.code(400).send({error:"invalid_ip"});
    const actor=await sessionIdentity(request);if(!actor)return reply.code(401).send({error:"unauthorized"});
    const users=await prisma.$queryRawUnsafe<Array<{id:string;email:string}>>(`SELECT "id","email" FROM "User" WHERE lower("email")=lower($1) LIMIT 1`,body.data.email);
    const user=users[0];if(!user)return reply.code(404).send({error:"user_not_found"});
    const protectedRoles=await prisma.userAdminRole.findMany({where:{userId:user.id},select:{role:true}});
    if(protectedRoles.some(item=>MODERATION_ROLES.includes(item.role as any)))return reply.code(409).send({error:"protected_staff_account"});
    const caseId=await ensureUserModerationCase(user.id);
    const existing=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ListingSpamHold" WHERE "userId"=$1 AND "status" IN ('PENDING','REJECTED') ORDER BY "updatedAt" DESC LIMIT 1`,user.id);
    const holdId=existing[0]?.id??randomUUID();
    const hash=body.data.ip?hashIpValue(body.data.ip):sha256(`manual-user-only:${user.id}:${holdId}`);
    const signals:PolicySignal[]=[{code:"MANUAL_BLOCK",field:"account"}];
    await prisma.$transaction(async tx=>{
      if(existing[0])await tx.$executeRawUnsafe(`UPDATE "ListingSpamHold" SET "ipHash"=$2,"status"='PENDING',"reasonCode"='MANUAL_MODERATION_BLOCK',"signals"=$3::jsonb,"attemptTitle"='Blocage manuel',"attemptDescription"=$4,"attemptListingId"=NULL,"attemptCount"="attemptCount"+1,"moderationCaseId"=$5,"reviewedByUserId"=NULL,"reviewedAt"=NULL,"reviewNote"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,holdId,hash,JSON.stringify(signals),body.data.note,caseId);
      else await tx.$executeRawUnsafe(`INSERT INTO "ListingSpamHold" ("id","userId","ipHash","status","reasonCode","signals","attemptTitle","attemptDescription","attemptListingId","moderationCaseId","reviewNote") VALUES ($1,$2,$3,'PENDING','MANUAL_MODERATION_BLOCK',$4::jsonb,'Blocage manuel',$5,NULL,$6,$5)`,holdId,user.id,hash,JSON.stringify(signals),body.data.note,caseId);
    });
    return reply.code(201).send({blocked:true,holdId,user:{id:user.id,email:user.email},ipBound:Boolean(body.data.ip)});
  });

  app.post("/admin/moderation/content-policy/holds/:id/decision",{preHandler:requireAdminRoles([...MODERATION_ROLES])},async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({action:z.enum(["APPROVE","KEEP_BLOCKED"]),note:z.string().trim().min(3).max(1000)}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const actor=await sessionIdentity(request);if(!actor)return reply.code(401).send({error:"unauthorized"});
    const rows=await prisma.$queryRawUnsafe<Array<HoldRow>>(`SELECT * FROM "ListingSpamHold" WHERE "id"=$1 LIMIT 1`,params.data.id);const hold=rows[0];if(!hold)return reply.code(404).send({error:"hold_not_found"});
    const status=body.data.action==="APPROVE"?"APPROVED":"REJECTED";
    await prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`UPDATE "ListingSpamHold" SET "status"=$2,"reviewedByUserId"=$3,"reviewedAt"=CURRENT_TIMESTAMP,"reviewNote"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,hold.id,status,actor.userId,body.data.note);
      if(body.data.action==="APPROVE")await tx.$executeRawUnsafe(`UPDATE "UserRiskProfile" SET "messagingRestrictedUntil"=NULL,"offerRestrictedUntil"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1`,hold.userId).catch(()=>undefined);
      if(hold.moderationCaseId)await tx.$executeRawUnsafe(`UPDATE "ModerationCase" SET "status"='RESOLVED',"decisionAction"=$2::"ModerationActionType","decisionReasonCode"=$3,"decisionStatement"=$4,"decidedByUserId"=$5,"decidedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,hold.moderationCaseId,body.data.action==="APPROVE"?"NONE":"SUSPEND_USER",body.data.action==="APPROVE"?"SPAM_HOLD_APPROVED":"SPAM_CONFIRMED",body.data.note,actor.userId);
    });
    return reply.send({resolved:true,status});
  });
}

export async function spamHoldPreHandler(request:FastifyRequest,reply:FastifyReply){
  if(["GET","HEAD","OPTIONS"].includes(request.method))return;
  const path=request.url.split("?")[0]??"";
  if(path.startsWith("/admin/")||path.startsWith("/security/")||path.startsWith("/auth/")||path.startsWith("/oauth/")||path.includes("webhook"))return;
  const session=await sessionIdentity(request);if(!session)return;
  if(session.user.roles.some(r=>MODERATION_ROLES.includes(r.role as any)))return;
  const hold=await getBlockingSpamHold(request,session.userId);if(!hold)return;
  return reply.code(423).send({error:"account_security_hold",reasonCode:hold.reasonCode,redirect:"/compte-suspendu"});
}