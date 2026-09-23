import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";

const SESSION_COOKIE="pa_session";
const VIEW_ROLES=["SUPER_ADMIN","ADMIN","MODERATOR","SUPPORT","COMPLIANCE"] as const;
const ACTION_ROLES=["SUPER_ADMIN","ADMIN","MODERATOR","COMPLIANCE"] as const;
const HARD_EVENT_TYPES=new Set(["OFF_PLATFORM_MESSAGE","MESSAGE_RATE_LIMIT","OFFER_RATE_LIMIT","LISTING_CONTENT_SPAM"]);

type RiskSignal={code:string;weight:number;detail:string};
type RiskLevel="LOW"|"MEDIUM"|"HIGH"|"CRITICAL";
function sha256(v:string){return createHash("sha256").update(v).digest("hex")}
function levelFor(score:number):RiskLevel{return score>=75?"CRITICAL":score>=55?"HIGH":score>=25?"MEDIUM":"LOW"}
function clamp(n:number,min:number,max:number){return Math.min(max,Math.max(min,n))}
function addSignal(signals:RiskSignal[],code:string,weight:number,detail:string){if(weight>0)signals.push({code,weight,detail})}

export async function ensureRiskSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "UserRiskEvent" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"eventType" TEXT NOT NULL,"weight" INTEGER NOT NULL DEFAULT 0,"metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "UserRiskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,CONSTRAINT "UserRiskEvent_weight_check" CHECK ("weight">=0 AND "weight"<=100))`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserRiskEvent_user_created_idx" ON "UserRiskEvent"("userId","createdAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserRiskEvent_type_created_idx" ON "UserRiskEvent"("eventType","createdAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "UserRiskProfile" ("userId" TEXT PRIMARY KEY,"score" INTEGER NOT NULL DEFAULT 0,"level" "FraudRiskLevel" NOT NULL DEFAULT 'LOW',"signals" JSONB NOT NULL DEFAULT '[]'::jsonb,"messagingRestrictedUntil" TIMESTAMP(3),"offerRestrictedUntil" TIMESTAMP(3),"reviewRequired" BOOLEAN NOT NULL DEFAULT FALSE,"commerceReviewRequired" BOOLEAN NOT NULL DEFAULT FALSE,"lastEventAt" TIMESTAMP(3),"assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "UserRiskProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,CONSTRAINT "UserRiskProfile_score_check" CHECK ("score">=0 AND "score"<=100))`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserRiskProfile_level_score_idx" ON "UserRiskProfile"("level","score" DESC,"updatedAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "UserRiskProfile_review_idx" ON "UserRiskProfile"("reviewRequired","score" DESC)`);
}

export async function recordUserRiskEvent(args:{userId:string;eventType:string;weight:number;metadata?:Record<string,unknown>}){
  await ensureRiskSchema();
  await prisma.$executeRawUnsafe(`INSERT INTO "UserRiskEvent" ("id","userId","eventType","weight","metadata") VALUES ($1,$2,$3,$4,$5::jsonb)`,randomUUID(),args.userId,args.eventType,clamp(Math.round(args.weight),0,100),JSON.stringify(args.metadata??{}));
  return assessUserRisk(args.userId);
}

export async function assessUserRisk(userId:string){
  await ensureRiskSchema();
  const users=await prisma.$queryRawUnsafe<Array<{id:string;createdAt:Date;emailVerifiedAt:Date|null;failedLoginAttempts:number;phone:string|null;phoneVerifiedAt:Date|null}>>(`SELECT u."id",u."createdAt",u."emailVerifiedAt",u."failedLoginAttempts",p."phone",p."phoneVerifiedAt" FROM "User" u LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE u."id"=$1 LIMIT 1`,userId);
  const user=users[0];if(!user)return null;
  const [events,reports,blocks,disputes,listingRisk]=await Promise.all([
    prisma.$queryRawUnsafe<Array<{eventType:string;count:bigint;weight:bigint;hard24:bigint}>>(`SELECT "eventType",COUNT(*)::bigint AS count,COALESCE(SUM("weight"),0)::bigint AS weight,COUNT(*) FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours')::bigint AS "hard24" FROM "UserRiskEvent" WHERE "userId"=$1 AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' GROUP BY "eventType"`,userId),
    prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "TrustReport" tr LEFT JOIN "Message" m ON tr."targetType"='MESSAGE' AND m."id"=tr."targetId" LEFT JOIN "Listing" l ON tr."targetType"='LISTING' AND l."id"=tr."targetId" LEFT JOIN "Store" s ON tr."targetType"='STORE' AND s."id"=tr."targetId" WHERE tr."status" NOT IN ('DISMISSED','CLOSED') AND ( (tr."targetType"='USER' AND tr."targetId"=$1) OR (tr."targetType"='MESSAGE' AND m."senderId"=$1) OR (tr."targetType"='LISTING' AND l."sellerId"=$1) OR (tr."targetType"='STORE' AND s."ownerId"=$1) )`,userId),
    prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "UserBlock" WHERE "blockedId"=$1 AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '90 days'`,userId).catch(()=>[{count:0n}]),
    prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "MarketplaceDispute" d JOIN "MarketplaceOrder" o ON o."id"=d."orderId" WHERE o."sellerId"=$1 AND d."status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED')`,userId).catch(()=>[{count:0n}]),
    prisma.$queryRawUnsafe<Array<{score:number|null}>>(`SELECT MAX(a."score")::int AS score FROM "FraudRiskAssessment" a JOIN "Listing" l ON a."subjectType"='LISTING' AND a."subjectId"=l."id" WHERE l."sellerId"=$1 AND a."createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days'`,userId).catch(()=>[{score:null}]),
  ]);
  const signals:RiskSignal[]=[];
  const ageDays=Math.floor((Date.now()-user.createdAt.getTime())/86400000);
  if(ageDays<2)addSignal(signals,"VERY_NEW_ACCOUNT",8,"Compte créé depuis moins de 48 h");else if(ageDays<7)addSignal(signals,"NEW_ACCOUNT",4,"Compte créé depuis moins de 7 jours");
  if(!user.emailVerifiedAt)addSignal(signals,"EMAIL_UNVERIFIED",12,"Adresse e-mail non vérifiée");
  if(!user.phoneVerifiedAt)addSignal(signals,"PHONE_UNVERIFIED",5,"Téléphone non vérifié");
  if(user.failedLoginAttempts>0)addSignal(signals,"FAILED_LOGINS",Math.min(12,user.failedLoginAttempts*3),`${user.failedLoginAttempts} tentative(s) de connexion échouée(s)`);
  const eventWeight=Math.min(55,events.reduce((sum,r)=>sum+Number(r.weight),0));if(eventWeight)addSignal(signals,"BEHAVIOUR_EVENTS",eventWeight,"Signaux comportementaux récents");
  const reportCount=Number(reports[0]?.count??0n);if(reportCount)addSignal(signals,"ACTIVE_REPORTS",Math.min(20,reportCount*6),`${reportCount} signalement(s) actif(s)`);
  const blockCount=Number(blocks[0]?.count??0n);if(blockCount)addSignal(signals,"BLOCKED_BY_USERS",Math.min(12,blockCount*3),`${blockCount} blocage(s) par d'autres membres`);
  const disputeCount=Number(disputes[0]?.count??0n);if(disputeCount)addSignal(signals,"ACTIVE_DISPUTES",Math.min(18,disputeCount*9),`${disputeCount} litige(s) actif(s)`);
  const maxListingRisk=Number(listingRisk[0]?.score??0);if(maxListingRisk>=75)addSignal(signals,"RISKY_LISTINGS",12,"Annonce récente à risque critique");else if(maxListingRisk>=55)addSignal(signals,"RISKY_LISTINGS",8,"Annonce récente à risque élevé");else if(maxListingRisk>=25)addSignal(signals,"RISKY_LISTINGS",4,"Annonce récente à risque moyen");
  const score=clamp(signals.reduce((sum,s)=>sum+s.weight,0),0,100);const level=levelFor(score);
  const hard24=events.filter(r=>HARD_EVENT_TYPES.has(r.eventType)).reduce((sum,r)=>sum+Number(r.hard24),0);
  const offPlatform24=events.filter(r=>r.eventType==="OFF_PLATFORM_MESSAGE").reduce((sum,r)=>sum+Number(r.hard24),0);
  let autoRestrictionUntil:Date|null=null;
  if(offPlatform24>=2||(level==="CRITICAL"&&hard24>0))autoRestrictionUntil=new Date(Date.now()+24*3600000);
  else if(level==="HIGH"&&hard24>0)autoRestrictionUntil=new Date(Date.now()+2*3600000);
  else if(hard24>=4)autoRestrictionUntil=new Date(Date.now()+3600000);
  const reviewRequired=score>=45;const commerceReviewRequired=score>=55||disputeCount>=2;
  await prisma.$executeRawUnsafe(`INSERT INTO "FraudRiskAssessment" ("id","subjectType","subjectId","score","level","signals","modelVersion") VALUES ($1,'USER',$2,$3,$4::"FraudRiskLevel",$5::jsonb,'rules-v2-user')`,randomUUID(),userId,score,level,JSON.stringify(signals));
  await prisma.$executeRawUnsafe(`INSERT INTO "UserRiskProfile" ("userId","score","level","signals","messagingRestrictedUntil","offerRestrictedUntil","reviewRequired","commerceReviewRequired","lastEventAt","assessedAt","updatedAt") VALUES ($1,$2,$3::"FraudRiskLevel",$4::jsonb,$5,$5,$6,$7,(SELECT MAX("createdAt") FROM "UserRiskEvent" WHERE "userId"=$1),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("userId") DO UPDATE SET "score"=EXCLUDED."score","level"=EXCLUDED."level","signals"=EXCLUDED."signals","messagingRestrictedUntil"=CASE WHEN EXCLUDED."messagingRestrictedUntil" IS NULL THEN "UserRiskProfile"."messagingRestrictedUntil" ELSE GREATEST("UserRiskProfile"."messagingRestrictedUntil",EXCLUDED."messagingRestrictedUntil") END,"offerRestrictedUntil"=CASE WHEN EXCLUDED."offerRestrictedUntil" IS NULL THEN "UserRiskProfile"."offerRestrictedUntil" ELSE GREATEST("UserRiskProfile"."offerRestrictedUntil",EXCLUDED."offerRestrictedUntil") END,"reviewRequired"=EXCLUDED."reviewRequired","commerceReviewRequired"=EXCLUDED."commerceReviewRequired","lastEventAt"=EXCLUDED."lastEventAt","assessedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP`,userId,score,level,JSON.stringify(signals),autoRestrictionUntil,reviewRequired,commerceReviewRequired);
  if(score>=55){const priority=level==="CRITICAL"?100:80;await prisma.$executeRawUnsafe(`INSERT INTO "ModerationCase" ("id","targetType","targetId","priority","riskScore","automatedDecision") SELECT $1,'USER',$2,$3,$4,FALSE WHERE NOT EXISTS (SELECT 1 FROM "ModerationCase" WHERE "targetType"='USER' AND "targetId"=$2 AND "status" NOT IN ('RESOLVED','CLOSED'))`,randomUUID(),userId,priority,score);await prisma.$executeRawUnsafe(`UPDATE "ModerationCase" SET "riskScore"=$1,"priority"=GREATEST("priority",$2),"updatedAt"=CURRENT_TIMESTAMP WHERE "targetType"='USER' AND "targetId"=$3 AND "status" NOT IN ('RESOLVED','CLOSED')`,score,priority,userId)}
  return{userId,score,level,signals,reviewRequired,commerceReviewRequired,messagingRestrictedUntil:autoRestrictionUntil,hardEvents24:hard24};
}

export async function getUserRiskPolicy(userId:string){
  await ensureRiskSchema();
  const rows=await prisma.$queryRawUnsafe<Array<{score:number;level:RiskLevel;messagingRestrictedUntil:Date|null;offerRestrictedUntil:Date|null;reviewRequired:boolean;commerceReviewRequired:boolean;assessedAt:Date}>>(`SELECT "score","level","messagingRestrictedUntil","offerRestrictedUntil","reviewRequired","commerceReviewRequired","assessedAt" FROM "UserRiskProfile" WHERE "userId"=$1 LIMIT 1`,userId);
  const row=rows[0];if(!row)return{score:0,level:"LOW" as RiskLevel,messagingRestricted:false,offerRestricted:false,messagingRestrictedUntil:null,offerRestrictedUntil:null,reviewRequired:false,commerceReviewRequired:false};
  const now=Date.now();return{...row,messagingRestricted:Boolean(row.messagingRestrictedUntil&&row.messagingRestrictedUntil.getTime()>now),offerRestricted:Boolean(row.offerRestrictedUntil&&row.offerRestrictedUntil.getTime()>now)};
}

async function actorId(request:FastifyRequest){const token=request.cookies[SESSION_COOKIE];if(!token)return null;const s=await prisma.session.findUnique({where:{tokenHash:sha256(token)},select:{userId:true,revokedAt:true,expiresAt:true}});return s&&!s.revokedAt&&s.expiresAt>new Date()?s.userId:null}
async function audit(request:FastifyRequest,action:string,userId:string,metadata?:unknown){const actor=await actorId(request);if(!actor)return;await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,'USER_RISK',$4,$5::jsonb)`,randomUUID(),actor,action,userId,JSON.stringify(metadata??{})).catch(()=>undefined)}

export async function registerRiskRoutes(app:FastifyInstance){
  await ensureRiskSchema();
  app.get("/admin/risk/overview",{preHandler:requireAdminRoles([...VIEW_ROLES])},async(request,reply)=>{const q=z.object({level:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).optional(),review:z.coerce.boolean().optional(),limit:z.coerce.number().int().min(10).max(200).default(100)}).safeParse(request.query);if(!q.success)return reply.code(400).send({error:"invalid_request"});const items=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT rp."userId",rp."score",rp."level",rp."signals",rp."messagingRestrictedUntil",rp."offerRestrictedUntil",rp."reviewRequired",rp."commerceReviewRequired",rp."lastEventAt",rp."assessedAt",u."email",u."kind",u."status",u."createdAt",COALESCE(p."displayName",p."firstName",u."email") AS "name",(SELECT COUNT(*)::int FROM "UserRiskEvent" e WHERE e."userId"=rp."userId" AND e."createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days') AS "eventCount30d" FROM "UserRiskProfile" rp JOIN "User" u ON u."id"=rp."userId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE ($1::text IS NULL OR rp."level"::text=$1) AND ($2::boolean IS NULL OR rp."reviewRequired"=$2) ORDER BY rp."score" DESC,rp."updatedAt" DESC LIMIT $3`,q.data.level??null,q.data.review??null,q.data.limit);const summary=await prisma.$queryRawUnsafe<Array<{level:string;count:bigint}>>(`SELECT "level"::text AS level,COUNT(*)::bigint AS count FROM "UserRiskProfile" GROUP BY "level" ORDER BY CASE "level" WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END`);const review=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "UserRiskProfile" WHERE "reviewRequired"=TRUE`);const restricted=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "UserRiskProfile" WHERE COALESCE("messagingRestrictedUntil",to_timestamp(0))>CURRENT_TIMESTAMP OR COALESCE("offerRestrictedUntil",to_timestamp(0))>CURRENT_TIMESTAMP`);return reply.send({items,summary:summary.map(x=>({...x,count:Number(x.count)})),reviewRequired:Number(review[0]?.count??0n),restricted:Number(restricted[0]?.count??0n)});});
  app.get("/admin/risk/users/:id",{preHandler:requireAdminRoles([...VIEW_ROLES])},async(request,reply)=>{const p=z.object({id:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_request"});const assessment=await assessUserRisk(p.data.id);if(!assessment)return reply.code(404).send({error:"user_not_found"});const profile=(await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT * FROM "UserRiskProfile" WHERE "userId"=$1`,p.data.id))[0]??null;const events=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","eventType","weight","metadata","createdAt" FROM "UserRiskEvent" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 100`,p.data.id);return reply.send({assessment,profile,events});});
  app.post("/admin/risk/users/:id/refresh",{preHandler:requireAdminRoles([...VIEW_ROLES])},async(request,reply)=>{const p=z.object({id:z.string().min(1)}).safeParse(request.params);if(!p.success)return reply.code(400).send({error:"invalid_request"});const risk=await assessUserRisk(p.data.id);if(!risk)return reply.code(404).send({error:"user_not_found"});await audit(request,"RISK_REFRESHED",p.data.id,{score:risk.score,level:risk.level});return reply.send({risk});});
  app.post("/admin/risk/users/:id/restriction",{preHandler:requireAdminRoles([...ACTION_ROLES])},async(request,reply)=>{const p=z.object({id:z.string().min(1)}).safeParse(request.params);const b=z.object({hours:z.number().int().min(0).max(168),reason:z.string().trim().min(3).max(500)}).safeParse(request.body);if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});const until=b.data.hours===0?null:new Date(Date.now()+b.data.hours*3600000);const rows=await prisma.$queryRawUnsafe<Array<{userId:string}>>(`INSERT INTO "UserRiskProfile" ("userId","messagingRestrictedUntil","offerRestrictedUntil","reviewRequired") SELECT $1,$2,$2,TRUE WHERE EXISTS(SELECT 1 FROM "User" WHERE "id"=$1) ON CONFLICT ("userId") DO UPDATE SET "messagingRestrictedUntil"=$2,"offerRestrictedUntil"=$2,"reviewRequired"=CASE WHEN $2 IS NULL THEN "UserRiskProfile"."reviewRequired" ELSE TRUE END,"updatedAt"=CURRENT_TIMESTAMP RETURNING "userId"`,p.data.id,until);if(!rows[0])return reply.code(404).send({error:"user_not_found"});await audit(request,b.data.hours===0?"RISK_RESTRICTION_CLEARED":"RISK_RESTRICTION_SET",p.data.id,{hours:b.data.hours,reason:b.data.reason});return reply.send({restrictedUntil:until});});
}

export async function sweepUserRisks(limit=500){
  await ensureRiskSchema();
  const users=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "User" WHERE "status"='ACTIVE' ORDER BY "createdAt" DESC LIMIT $1`,Math.min(Math.max(limit,1),1000));
  let assessed=0,high=0,critical=0,failed=0;
  for(const user of users){try{const risk=await assessUserRisk(user.id);if(!risk)continue;assessed++;if(risk.level==="HIGH")high++;if(risk.level==="CRITICAL")critical++}catch{failed++}}
  return{assessed,high,critical,failed};
}

export function startRiskSweepWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  const intervalMs=Math.max(Number(process.env.RISK_SWEEP_INTERVAL_MS??86400000),3600000);
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{const result=await sweepUserRisks(Number(process.env.RISK_SWEEP_BATCH_SIZE??500));log?.info(result,"user risk sweep processed")}catch(error){log?.error(error,"user risk sweep failed")}finally{running=false}};
  const first=setTimeout(()=>void tick(),60000);first.unref();
  const timer=setInterval(()=>void tick(),intervalMs);timer.unref();
  return timer;
}