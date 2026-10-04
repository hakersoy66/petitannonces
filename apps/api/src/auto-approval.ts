import { randomInt } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";
import { getUserReputation } from "./reputation.js";
import { getUserRiskPolicy } from "./risk-engine.js";
import { scanListingContent } from "./listing-content-policy.js";
import { activateListingLifetime } from "./listing-lifecycle.js";
import { deliverUserEvent } from "./notification-delivery.js";
import { rewardReferralAfterFirstPublishedListing } from "./referrals.js";
import { notifyListingIndexNow } from "./indexnow.js";
import { prepareListingSocialPost } from "./social-growth.js";
import { notifyFollowersForListing } from "./following.js";
import { notifyInstantSavedSearchesForListing } from "./saved-search-alerts.js";
import { queueAdminRoleEmail } from "./transactional-email.js";

const SETTINGS_KEY="moderation.autoApproval";
const ADMIN_ROLES=["SUPER_ADMIN","ADMIN"] as const;
const DEFAULT_SETTINGS={enabled:true,minDelaySeconds:60,maxDelaySeconds:60,minTrustScore:75,maxRiskScore:20,requireReliableSeller:true,requireEmailVerified:true};
const MIN_CLEAN_MANUAL_APPROVALS=3;
const HISTORY_VIOLATION_DAYS=180;

// A seller with a proven history of three human-approved, incident-free ads
// can be trusted even without marketplace sales/reviews. Keep this separate
// from the marketplace reputation badge (which requires completed sales).
export function listingHistoryTrustScore(manualApprovals:number,accountAgeDays:number){
 return Math.min(90,50+(accountAgeDays>=7?10:0)+Math.min(6,Math.max(0,manualApprovals))*5);
}
const settingsSchema=z.object({
  enabled:z.boolean(),
  minDelaySeconds:z.number().int().min(60).max(600),
  maxDelaySeconds:z.number().int().min(60).max(600),
  minTrustScore:z.number().int().min(50).max(100),
  maxRiskScore:z.number().int().min(0).max(24),
  requireReliableSeller:z.boolean(),
  requireEmailVerified:z.boolean(),
}).refine(v=>v.maxDelaySeconds>=v.minDelaySeconds,{message:"max_delay_before_min_delay",path:["maxDelaySeconds"]});
export type AutoApprovalSettings=z.infer<typeof settingsSchema>;

let schemaPromise:Promise<void>|null=null;
export function ensureAutoApprovalSchema(){
  if(schemaPromise)return schemaPromise;
  schemaPromise=(async()=>{
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingAutoApprovalQueue" ("listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,"sellerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"eligibleAt" TIMESTAMPTZ NOT NULL,"status" TEXT NOT NULL DEFAULT 'SCHEDULED',"trustScore" INTEGER NOT NULL DEFAULT 0,"riskScore" INTEGER NOT NULL DEFAULT 0,"reason" TEXT,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"processedAt" TIMESTAMPTZ,CONSTRAINT "ListingAutoApprovalQueue_status_check" CHECK ("status" IN ('SCHEDULED','PROCESSING','APPROVED','CANCELLED','FAILED')))`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ListingAutoApprovalQueue_due_idx" ON "ListingAutoApprovalQueue"("status","eligibleAt")`);
  })().catch(e=>{schemaPromise=null;throw e});
  return schemaPromise;
}

export async function getAutoApprovalSettings():Promise<AutoApprovalSettings>{
  const rows=await prisma.$queryRawUnsafe<Array<{value:unknown}>>(`SELECT "value" FROM "AdminSetting" WHERE "key"=$1 LIMIT 1`,SETTINGS_KEY).catch(()=>[]);
  const stored=rows[0]?.value&&typeof rows[0].value==="object"?rows[0].value as Record<string,unknown>:{};
  return settingsSchema.parse({...DEFAULT_SETTINGS,...stored});
}

async function saveAutoApprovalSettings(value:AutoApprovalSettings,actorUserId:string|null){
  await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedByUserId","updatedAt") VALUES ($1,$2::jsonb,$3,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=CURRENT_TIMESTAMP`,SETTINGS_KEY,JSON.stringify(value),actorUserId);
}

async function adminId(request:any){
  const token=request.cookies?.pa_session;if(!token)return null;
  const {createHash}=await import("node:crypto");
  const row=await prisma.session.findUnique({where:{tokenHash:createHash("sha256").update(token).digest("hex")},select:{userId:true,revokedAt:true,expiresAt:true}});
  return row&&!row.revokedAt&&row.expiresAt>new Date()?row.userId:null;
}

export async function evaluateAutoApprovalEligibility(sellerId:string,settings?:AutoApprovalSettings){
  const cfg=settings??await getAutoApprovalSettings();
  if(!cfg.enabled)return{eligible:false as const,reason:"disabled"};
  const [rep,risk,user,openCase,history,activeHold,activeReports]=await Promise.all([
    getUserReputation(sellerId),
    getUserRiskPolicy(sellerId),
    prisma.user.findUnique({where:{id:sellerId},select:{status:true,emailVerifiedAt:true,createdAt:true}}),
    prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ModerationCase" WHERE "targetType"='USER' AND "targetId"=$1 AND "status" NOT IN ('RESOLVED','CLOSED') LIMIT 1`,sellerId),
    prisma.$queryRawUnsafe<Array<{approved:number;violations:number}>>(`
      SELECT
       COUNT(DISTINCT c."targetId") FILTER(WHERE c."status"='RESOLVED' AND c."decisionReasonCode"='MANUAL_APPROVAL' AND c."updatedAt">=CURRENT_TIMESTAMP-INTERVAL '365 days')::int AS approved,
       COUNT(*) FILTER(WHERE c."decisionReasonCode" IN ('PROHIBITED_CONTENT','INCOMPLETE_INFORMATION','INSUFFICIENT_PHOTOS','DUPLICATE_LISTING','PROHIBITED_ITEM','CONTENT_POLICY_BLOCK','FRAUD','SPAM') AND c."updatedAt">=CURRENT_TIMESTAMP-($2::int*INTERVAL '1 day'))::int AS violations
      FROM "ModerationCase" c JOIN "Listing" l ON c."targetType"='LISTING' AND l."id"=c."targetId"
      WHERE l."sellerId"=$1`,sellerId,HISTORY_VIOLATION_DAYS),
    prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "ListingSpamHold" WHERE "userId"=$1 AND "status" IN ('PENDING','REJECTED') AND "updatedAt">=CURRENT_TIMESTAMP-INTERVAL '180 days' LIMIT 1`,sellerId),
    prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT tr."id" FROM "TrustReport" tr LEFT JOIN "Listing" l ON tr."targetType"='LISTING' AND l."id"=tr."targetId" WHERE tr."status" NOT IN ('DISMISSED','CLOSED') AND ((tr."targetType"='USER' AND tr."targetId"=$1) OR l."sellerId"=$1) LIMIT 1`,sellerId),
  ]);
  if(!user||user.status!=="ACTIVE")return{eligible:false as const,reason:"account_not_active"};
  if(!rep)return{eligible:false as const,reason:"reputation_unavailable"};
  const ageDays=(Date.now()-user.createdAt.getTime())/86400000;
  const manualApprovals=history[0]?.approved??0;
  const trustScore=Math.max(rep.trust.score,listingHistoryTrustScore(manualApprovals,ageDays));
  const base={trustScore,riskScore:risk.score,phoneVerified:Boolean(rep.metrics.phoneVerified),manualApprovals};
  if(cfg.requireEmailVerified&&!user.emailVerifiedAt)return{eligible:false as const,reason:"email_not_verified",...base};
  if(!base.phoneVerified)return{eligible:false as const,reason:"phone_not_verified",...base};
  if(ageDays<7)return{eligible:false as const,reason:"account_too_recent",...base};
  if(manualApprovals<MIN_CLEAN_MANUAL_APPROVALS)return{eligible:false as const,reason:"insufficient_manually_approved_history",...base};
  if((history[0]?.violations??0)>0||activeHold.length||activeReports.length)return{eligible:false as const,reason:"moderation_history_or_report",...base};
  if(risk.level!=="LOW"||risk.reviewRequired||risk.commerceReviewRequired||risk.messagingRestricted||risk.offerRestricted||risk.score>cfg.maxRiskScore)return{eligible:false as const,reason:"risk_review_required",...base};
  if(openCase.length)return{eligible:false as const,reason:"open_user_moderation_case",...base};
  if(cfg.requireReliableSeller&&!(rep.trust.reliableSeller||manualApprovals>=MIN_CLEAN_MANUAL_APPROVALS))return{eligible:false as const,reason:"not_reliable",...base};
  if(trustScore<cfg.minTrustScore)return{eligible:false as const,reason:"trust_score_below_threshold",...base};
  return{eligible:true as const,reason:"trusted_clean_listing_history",...base};
}

export async function scheduleTrustedListingAutoApproval(listingId:string,sellerId:string){
  await ensureAutoApprovalSchema();
  const cfg=await getAutoApprovalSettings();
  const eligibility=await evaluateAutoApprovalEligibility(sellerId,cfg);
  if(!eligibility.eligible)return{scheduled:false as const,...eligibility};
  const delaySeconds=cfg.minDelaySeconds===cfg.maxDelaySeconds?cfg.minDelaySeconds:randomInt(cfg.minDelaySeconds,cfg.maxDelaySeconds+1);
  // Use the database clock for both scheduling and worker comparisons. The app host
  // and PostgreSQL may have different timezone/clock configuration; mixing clocks
  // can make a future approval look immediately due.
  const scheduled=await prisma.$queryRawUnsafe<Array<{eligibleAt:Date}>>(`INSERT INTO "ListingAutoApprovalQueue" ("listingId","sellerId","eligibleAt","status","trustScore","riskScore","reason") VALUES ($1,$2,CURRENT_TIMESTAMP + ($3::int * INTERVAL '1 second'),'SCHEDULED',$4,$5,$6) ON CONFLICT ("listingId") DO UPDATE SET "sellerId"=EXCLUDED."sellerId","eligibleAt"=EXCLUDED."eligibleAt","status"='SCHEDULED',"trustScore"=EXCLUDED."trustScore","riskScore"=EXCLUDED."riskScore","reason"=EXCLUDED."reason","processedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP RETURNING "eligibleAt"`,listingId,sellerId,delaySeconds,eligibility.trustScore,eligibility.riskScore,eligibility.reason);
  const eligibleAt=scheduled[0]?.eligibleAt??new Date(Date.now()+delaySeconds*1000);
  return{scheduled:true as const,eligibleAt,delaySeconds,trustScore:eligibility.trustScore,riskScore:eligibility.riskScore};
}

async function notifyManualReview(listingId:string,reason:string){
 await queueAdminRoleEmail({
  roles:["SUPER_ADMIN","ADMIN"],
  eventKind:"ADMIN_LISTING_PENDING",
  title:"Annonce à vérifier manuellement",
  body:"Une annonce initialement prévue pour validation rapide nécessite désormais une vérification de modération.",
  actionUrl:"https://admin.petitannonces.fr/moderation",
  metadata:{purpose:"AUTO_APPROVAL_TO_MANUAL",listingId,reason},
 }).catch(()=>undefined);
}

async function approveOne(listingId:string){
  const cfg=await getAutoApprovalSettings();
  if(!cfg.enabled){await prisma.$executeRawUnsafe(`UPDATE "ListingAutoApprovalQueue" SET "status"='CANCELLED',"reason"='disabled_before_processing',"processedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1 AND "status" IN ('SCHEDULED','PROCESSING')`,listingId);await notifyManualReview(listingId,"disabled_before_processing");return false}
  const listing=await prisma.listing.findUnique({where:{id:listingId},select:{id:true,sellerId:true,status:true,title:true,description:true,slug:true,publishedAt:true,category:{select:{domain:true}}}});
  if(!listing||listing.status!=="PENDING"){await prisma.$executeRawUnsafe(`UPDATE "ListingAutoApprovalQueue" SET "status"='CANCELLED',"reason"='listing_not_pending',"processedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1`,listingId);return false}
  const [scan,eligibility,reports,caseRows,media,listingFraud]=await Promise.all([
    scanListingContent(listing.title,listing.description),
    evaluateAutoApprovalEligibility(listing.sellerId,cfg),
    prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "TrustReport" WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('DISMISSED','CLOSED')`,listing.id),
    prisma.$queryRawUnsafe<Array<{id:string;riskScore:number;status:string}>>(`SELECT "id","riskScore","status" FROM "ModerationCase" WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('RESOLVED','CLOSED') ORDER BY "createdAt" DESC LIMIT 1`,listing.id),
    prisma.$queryRawUnsafe<Array<{ready:number;unfinished:number}>>(`SELECT COUNT(*) FILTER(WHERE "status"='READY' AND "publicUrl" IS NOT NULL)::int AS ready,COUNT(*) FILTER(WHERE "status"<>'READY' OR "publicUrl" IS NULL)::int AS unfinished FROM "ListingMedia" WHERE "listingId"=$1`,listing.id),
    prisma.$queryRawUnsafe<Array<{score:number|null}>>(`SELECT MAX("score")::int AS score FROM "FraudRiskAssessment" WHERE "subjectType"='LISTING' AND "subjectId"=$1`,listing.id),
  ]);
  const c=caseRows[0];
  const invalidMedia=(media[0]?.ready??0)<1||(media[0]?.unfinished??0)>0;
  const requiresHumanReview=listing.category.domain==="ANIMAL"||listing.category.domain==="JOB";
  const fraudScore=listingFraud[0]?.score??0;
  if(scan.blocked||!eligibility.eligible||Number(reports[0]?.count??0n)>0||!c||c.status!=="OPEN"||c.riskScore>cfg.maxRiskScore||fraudScore>cfg.maxRiskScore||invalidMedia||requiresHumanReview){
    const reason=scan.blocked?"content_policy_blocked":!eligibility.eligible?eligibility.reason:Number(reports[0]?.count??0n)>0?"active_report":invalidMedia?"media_requires_review":requiresHumanReview?"sensitive_category_review":"listing_risk_too_high";
    await prisma.$executeRawUnsafe(`UPDATE "ListingAutoApprovalQueue" SET "status"='CANCELLED',"reason"=$2,"processedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1`,listing.id,reason);
    await notifyManualReview(listing.id,reason);
    return false;
  }
  const firstPublication=listing.publishedAt==null;
  const publishedAt=listing.publishedAt??new Date();
  const changed=await prisma.$transaction(async tx=>{
    const u=await tx.listing.updateMany({where:{id:listing.id,status:"PENDING"},data:{status:"PUBLISHED",publishedAt}});
    if(!u.count)return false;
    const approvalReason="AUTO_APPROVED_TRUSTED";
    const approvalStatement="Annonce approuvée après délai de sécurité : contacts vérifiés, trois annonces validées manuellement, score de confiance suffisant et contrôles anti-fraude réussis.";
    const caseUpdated=await tx.$executeRawUnsafe(`UPDATE "ModerationCase" SET "status"='RESOLVED',"automatedDecision"=TRUE,"decisionAction"='NONE'::"ModerationActionType","decisionReasonCode"=$2,"decisionStatement"=$3,"decidedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='OPEN' AND "riskScore"<=$4`,c.id,approvalReason,approvalStatement,cfg.maxRiskScore);
    if(caseUpdated!==1)throw new Error("moderation_case_changed_before_auto_approval");
    await tx.$executeRawUnsafe(`UPDATE "ListingAutoApprovalQueue" SET "status"='APPROVED',"reason"=$2,"processedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1`,listing.id,"auto_approved_trusted");
    return true;
  });
  if(!changed)return false;
  await activateListingLifetime(listing.id,publishedAt);
  await rewardReferralAfterFirstPublishedListing(listing.sellerId).catch(()=>undefined);
  await notifyListingIndexNow(listing.id).catch(()=>undefined);
  await prepareListingSocialPost(listing.id).catch(()=>undefined);
  if(firstPublication){
    await notifyFollowersForListing(listing.id).catch(()=>undefined);
    await notifyInstantSavedSearchesForListing(listing.id).catch(()=>undefined);
  }
  await deliverUserEvent({userId:listing.sellerId,eventKind:"LISTING",notificationKind:"LISTING",title:"Votre annonce est en ligne",body:`Votre annonce « ${listing.title??"Sans titre"} » a été vérifiée automatiquement et publiée.`,actionUrl:listing.slug?`/annonce/${encodeURIComponent(listing.slug)}`:"/mon-compte/annonces",metadata:{purpose:"LISTING_AUTO_APPROVAL",listingId:listing.id,automatic:true},dedupeKey:`listing-auto-approved:${listing.id}:${publishedAt.toISOString()}`});
  return true;
}

export async function processDueAutoApprovals(limit=50){
  await ensureAutoApprovalSchema();
  const rows=await prisma.$queryRawUnsafe<Array<{listingId:string}>>(`SELECT "listingId" FROM "ListingAutoApprovalQueue" WHERE "status"='SCHEDULED' AND "eligibleAt"<=CURRENT_TIMESTAMP ORDER BY "eligibleAt" ASC LIMIT $1`,limit);
  let approved=0;
  for(const row of rows){
    const claimed=await prisma.$queryRawUnsafe<Array<{listingId:string}>>(`UPDATE "ListingAutoApprovalQueue" SET "status"='PROCESSING',"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1 AND "status"='SCHEDULED' RETURNING "listingId"`,row.listingId);
    if(!claimed[0])continue;
    try{if(await approveOne(row.listingId))approved++}catch(error){await prisma.$executeRawUnsafe(`UPDATE "ListingAutoApprovalQueue" SET "status"='FAILED',"reason"=$2,"processedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "listingId"=$1`,row.listingId,error instanceof Error?error.message.slice(0,220):"worker_error").catch(()=>undefined);await notifyManualReview(row.listingId,"worker_failure")}
  }
  return{processed:rows.length,approved};
}

export function registerAutoApprovalAdminRoutes(app:FastifyInstance){
  app.get("/admin/settings/auto-approval",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(_request,reply)=>reply.send({settings:await getAutoApprovalSettings()}));
  app.put("/admin/settings/auto-approval",{preHandler:requireAdminRoles([...ADMIN_ROLES])},async(request,reply)=>{
    const parsed=settingsSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_auto_approval_settings",details:parsed.error.flatten()});
    await saveAutoApprovalSettings(parsed.data,await adminId(request));return reply.send({saved:true,settings:parsed.data});
  });
}

export function startAutoApprovalWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  const intervalMs=Math.max(Number(process.env.AUTO_APPROVAL_WORKER_INTERVAL_MS??15_000),10_000);let running=false;
  const tick=async()=>{if(running)return;running=true;try{const result=await processDueAutoApprovals();if(result.approved)log?.info(result,"trusted listings auto-approved")}catch(error){log?.error(error,"listing auto-approval worker failed")}finally{running=false}};
  void tick();const timer=setInterval(()=>void tick(),intervalMs);timer.unref();return timer;
}
