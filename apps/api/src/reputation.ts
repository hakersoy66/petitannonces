import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import { calculateTrustScore } from "./trust-score.js";
import { deliverUserEvent } from "./notification-delivery.js";

export type ReputationBadgeCode = "PROFILE_VERIFIE" | "REPOND_RAPIDEMENT" | "VENDEUR_FIABLE" | "EXPEDITION_RAPIDE" | "TOP_VENDEUR";
export type ReputationBadge = {
  code: ReputationBadgeCode;
  label: string;
  shortLabel: string;
  description: string;
  icon: "shield" | "bolt" | "circle-check" | "truck" | "star";
  priority: number;
};

export type ReputationMetrics = {
  verified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  kind?: string;
  memberSince: Date;
  reviewCount: number;
  reviewAverage: number | null;
  completedSales: number;
  canceledSales: number;
  disputedSales: number;
  responseSamples: number;
  responseWithinTwoHoursRate: number;
  averageResponseMinutes: number | null;
  shipmentSamples: number;
  shipmentWithin48HoursRate: number;
};

const BADGES: Record<ReputationBadgeCode, ReputationBadge> = {
  PROFILE_VERIFIE: { code:"PROFILE_VERIFIE", label:"Profil vérifié", shortLabel:"Vérifié", description:"Identité de contact ou activité professionnelle vérifiée par Petit Annonces.", icon:"shield", priority:90 },
  REPOND_RAPIDEMENT: { code:"REPOND_RAPIDEMENT", label:"Répond rapidement", shortLabel:"Réponse rapide", description:"Répond rapidement et régulièrement aux premiers messages des acheteurs.", icon:"bolt", priority:70 },
  VENDEUR_FIABLE: { code:"VENDEUR_FIABLE", label:"Vendeur fiable", shortLabel:"Vendeur fiable", description:"Historique de transactions réussies, bonnes évaluations et faible taux d’incidents.", icon:"circle-check", priority:100 },
  EXPEDITION_RAPIDE: { code:"EXPEDITION_RAPIDE", label:"Expédition rapide", shortLabel:"Expédition rapide", description:"Expédie habituellement les commandes dans les 48 heures après confirmation du paiement.", icon:"truck", priority:60 },
  TOP_VENDEUR: { code:"TOP_VENDEUR", label:"Top vendeur", shortLabel:"Top vendeur", description:"Excellent historique de vente, évaluations élevées et service réactif.", icon:"star", priority:110 },
};

export function buildReputation(metrics: ReputationMetrics) {
  const totalTerminal = metrics.completedSales + metrics.canceledSales + metrics.disputedSales;
  const cancellationRate = totalTerminal > 0 ? metrics.canceledSales / totalTerminal : 0;
  const disputeRate = totalTerminal > 0 ? metrics.disputedSales / totalTerminal : 0;
  const trust = calculateTrustScore({
    verified: metrics.verified,
    emailVerified: metrics.emailVerified,
    reviewCount: metrics.reviewCount,
    reviewAverage: metrics.reviewAverage,
    completedSales: metrics.completedSales,
    memberSince: metrics.memberSince,
  });

  const profileVerified = metrics.verified || (metrics.emailVerified && metrics.phoneVerified);
  const respondsQuickly = metrics.responseSamples >= 3 && metrics.responseWithinTwoHoursRate >= 0.80 && (metrics.averageResponseMinutes ?? Number.POSITIVE_INFINITY) <= 120;
  const reliableSeller = trust.reliableSeller && cancellationRate <= 0.10 && disputeRate <= 0.05;
  const fastShipping = metrics.shipmentSamples >= 3 && metrics.shipmentWithin48HoursRate >= 0.80;
  const topSeller = reliableSeller && respondsQuickly && metrics.completedSales >= 10 && metrics.reviewCount >= 5 && (metrics.reviewAverage ?? 0) >= 4.7;

  const earned: ReputationBadge[] = [];
  if (profileVerified) earned.push(BADGES.PROFILE_VERIFIE);
  if (respondsQuickly) earned.push(BADGES.REPOND_RAPIDEMENT);
  if (reliableSeller) earned.push(BADGES.VENDEUR_FIABLE);
  if (fastShipping) earned.push(BADGES.EXPEDITION_RAPIDE);
  if (topSeller) earned.push(BADGES.TOP_VENDEUR);
  earned.sort((a,b)=>b.priority-a.priority);

  return {
    badges: earned,
    cardBadges: earned.slice(0,2),
    trust: { ...trust, reliableSeller },
    metrics: {
      emailVerified: metrics.emailVerified,
      phoneVerified: metrics.phoneVerified,
      reviewCount: metrics.reviewCount,
      reviewAverage: metrics.reviewAverage,
      completedSales: metrics.completedSales,
      cancellationRate,
      disputeRate,
      responseSamples: metrics.responseSamples,
      responseWithinTwoHoursRate: metrics.responseWithinTwoHoursRate,
      averageResponseMinutes: metrics.averageResponseMinutes,
      shipmentSamples: metrics.shipmentSamples,
      shipmentWithin48HoursRate: metrics.shipmentWithin48HoursRate,
    },
  };
}

export async function getUserReputation(userId:string){
  const [identityRows, reviewRows, orderRows, responseRows, shipmentRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{kind:string;createdAt:Date;emailVerified:boolean;phoneVerified:boolean;verified:boolean}>>(`
      SELECT u."kind"::text AS kind,u."createdAt",(u."emailVerifiedAt" IS NOT NULL) AS "emailVerified",
        (p."phoneVerifiedAt" IS NOT NULL) AS "phoneVerified",
        (COALESCE(b."verificationStatus"='VERIFIED',FALSE) OR EXISTS(SELECT 1 FROM "Store" s WHERE s."ownerId"=u."id" AND s."status"='ACTIVE' AND s."isVerified"=TRUE)) AS verified
      FROM "User" u LEFT JOIN "UserProfile" p ON p."userId"=u."id" LEFT JOIN "BusinessProfile" b ON b."userId"=u."id" WHERE u."id"=$1 LIMIT 1`,userId),
    prisma.$queryRawUnsafe<Array<{reviewCount:bigint;reviewAverage:number|null}>>(`SELECT COUNT(*)::bigint AS "reviewCount",AVG(r."rating")::float AS "reviewAverage" FROM "MarketplaceReview" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" AND o."status"='COMPLETED' WHERE r."revieweeId"=$1 AND r."direction"='BUYER_TO_SELLER'`,userId),
    prisma.$queryRawUnsafe<Array<{completedSales:bigint;canceledSales:bigint;disputedSales:bigint}>>(`SELECT
      COUNT(*) FILTER(WHERE o."status"='COMPLETED')::bigint AS "completedSales",
      COUNT(*) FILTER(
        WHERE o."status"='CANCELED'
          AND (
            o."paidAt" IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM "MarketplacePayment" mp
              WHERE mp."orderId"=o."id"
                AND mp."status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
            )
          )
      )::bigint AS "canceledSales",
      COUNT(*) FILTER(WHERE o."status"='DISPUTED')::bigint AS "disputedSales"
      FROM "MarketplaceOrder" o WHERE o."sellerId"=$1`,userId),
    prisma.$queryRawUnsafe<Array<{samples:bigint;within2h:bigint;averageMinutes:number|null}>>(`
      WITH response_samples AS (
        SELECT EXTRACT(EPOCH FROM (s.first_seller-b.first_buyer))/60.0 AS minutes
        FROM "Conversation" c
        JOIN LATERAL (SELECT MIN(m."createdAt") AS first_buyer FROM "Message" m WHERE m."conversationId"=c."id" AND m."senderId"=c."buyerId" AND m."createdAt">=CURRENT_TIMESTAMP-INTERVAL '90 days') b ON b.first_buyer IS NOT NULL
        JOIN LATERAL (SELECT MIN(m."createdAt") AS first_seller FROM "Message" m WHERE m."conversationId"=c."id" AND m."senderId"=c."sellerId" AND m."createdAt">b.first_buyer) s ON s.first_seller IS NOT NULL
        WHERE c."sellerId"=$1 AND s.first_seller>=b.first_buyer
      ) SELECT COUNT(*)::bigint AS samples,COUNT(*) FILTER(WHERE minutes<=120)::bigint AS within2h,AVG(minutes)::float AS "averageMinutes" FROM response_samples`,userId),
    prisma.$queryRawUnsafe<Array<{samples:bigint;within48h:bigint}>>(`SELECT COUNT(*)::bigint AS samples,COUNT(*) FILTER(WHERE s."shippedAt"<=o."paidAt"+INTERVAL '48 hours')::bigint AS within48h FROM "MarketplaceShipment" s JOIN "MarketplaceOrder" o ON o."id"=s."orderId" WHERE o."sellerId"=$1 AND o."paidAt" IS NOT NULL AND s."shippedAt" IS NOT NULL`,userId),
  ]);
  const identity=identityRows[0];
  if(!identity)return null;
  const reviews=reviewRows[0],orders=orderRows[0],responses=responseRows[0],shipments=shipmentRows[0];
  const responseSamples=Number(responses?.samples??0n),shipmentSamples=Number(shipments?.samples??0n);
  return buildReputation({
    verified:Boolean(identity.verified),emailVerified:Boolean(identity.emailVerified),phoneVerified:Boolean(identity.phoneVerified),kind:identity.kind,memberSince:identity.createdAt,
    reviewCount:Number(reviews?.reviewCount??0n),reviewAverage:reviews?.reviewAverage??null,
    completedSales:Number(orders?.completedSales??0n),canceledSales:Number(orders?.canceledSales??0n),disputedSales:Number(orders?.disputedSales??0n),
    responseSamples,responseWithinTwoHoursRate:responseSamples?Number(responses?.within2h??0n)/responseSamples:0,averageResponseMinutes:responses?.averageMinutes??null,
    shipmentSamples,shipmentWithin48HoursRate:shipmentSamples?Number(shipments?.within48h??0n)/shipmentSamples:0,
  });
}


const REPUTATION_BADGE_CODES=Object.keys(BADGES) as ReputationBadgeCode[];
let reputationSchemaPromise:Promise<void>|null=null;

export type ReputationBadgeHistoryItem={
  id:string;
  badgeCode:ReputationBadgeCode;
  badge:ReputationBadge;
  eventType:"EARNED"|"LOST";
  createdAt:Date;
  metadata:Record<string,unknown>|null;
};

export function ensureReputationSchema(){
  if(reputationSchemaPromise)return reputationSchemaPromise;
  reputationSchemaPromise=(async()=>{
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReputationUserSnapshot" ("userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,"initializedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"lastEvaluatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReputationBadgeState" ("userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"badgeCode" TEXT NOT NULL,"active" BOOLEAN NOT NULL DEFAULT FALSE,"earnedAt" TIMESTAMPTZ,"lostAt" TIMESTAMPTZ,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY ("userId","badgeCode"))`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ReputationBadgeEvent" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"badgeCode" TEXT NOT NULL,"eventType" TEXT NOT NULL,"metadata" JSONB,"createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReputationBadgeState_active_idx" ON "ReputationBadgeState"("active","badgeCode")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ReputationBadgeEvent_user_created_idx" ON "ReputationBadgeEvent"("userId","createdAt" DESC)`);
  })().catch(error=>{reputationSchemaPromise=null;throw error});
  return reputationSchemaPromise;
}

export async function getReputationBadgeHistory(userId:string,limit=20):Promise<ReputationBadgeHistoryItem[]>{
  await ensureReputationSchema();
  const rows=await prisma.$queryRawUnsafe<Array<{id:string;badgeCode:string;eventType:string;metadata:Record<string,unknown>|null;createdAt:Date}>>(`SELECT "id","badgeCode","eventType","metadata","createdAt" FROM "ReputationBadgeEvent" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT $2`,userId,Math.max(1,Math.min(limit,100)));
  return rows.filter(row=>row.badgeCode in BADGES&&(row.eventType==="EARNED"||row.eventType==="LOST")).map(row=>({id:row.id,badgeCode:row.badgeCode as ReputationBadgeCode,badge:BADGES[row.badgeCode as ReputationBadgeCode],eventType:row.eventType as "EARNED"|"LOST",createdAt:row.createdAt,metadata:row.metadata??null}));
}

function reputationEventMetadata(reputation:NonNullable<Awaited<ReturnType<typeof getUserReputation>>>){
  return {trustScore:reputation.trust.score,trustLevel:reputation.trust.level,...reputation.metrics};
}

export async function syncUserReputation(userId:string,{notify=true}:{notify?:boolean}={}){
  await ensureReputationSchema();
  const reputation=await getUserReputation(userId);if(!reputation)return null;
  const activeCodes=new Set(reputation.badges.map(b=>b.code));
  const metadata=reputationEventMetadata(reputation);
  const result=await prisma.$transaction(async(tx:any)=>{
    const insertedSnapshot=await tx.$executeRawUnsafe(`INSERT INTO "ReputationUserSnapshot" ("userId","initializedAt","lastEvaluatedAt") VALUES ($1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("userId") DO NOTHING`,userId);
    const snapshotRows=await tx.$queryRawUnsafe(`SELECT "userId","lastEvaluatedAt" FROM "ReputationUserSnapshot" WHERE "userId"=$1 LIMIT 1 FOR UPDATE`,userId) as Array<{userId:string;lastEvaluatedAt:Date}>;
    if(insertedSnapshot===1){
      for(const code of REPUTATION_BADGE_CODES){
        const active=activeCodes.has(code);
        await tx.$executeRawUnsafe(`INSERT INTO "ReputationBadgeState" ("userId","badgeCode","active","earnedAt","lostAt","updatedAt") VALUES ($1,$2,$3,CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,NULL,CURRENT_TIMESTAMP) ON CONFLICT ("userId","badgeCode") DO UPDATE SET "active"=EXCLUDED."active","earnedAt"=CASE WHEN EXCLUDED."active" THEN COALESCE("ReputationBadgeState"."earnedAt",CURRENT_TIMESTAMP) ELSE "ReputationBadgeState"."earnedAt" END,"updatedAt"=CURRENT_TIMESTAMP`,userId,code,active);
      }
      return {baseline:true,events:[] as Array<{id:string;code:ReputationBadgeCode;eventType:"EARNED"|"LOST"}>};
    }
    const stateRows=await tx.$queryRawUnsafe(`SELECT "badgeCode","active" FROM "ReputationBadgeState" WHERE "userId"=$1`,userId) as Array<{badgeCode:string;active:boolean}>;
    const states=new Map(stateRows.map(row=>[row.badgeCode,row.active] as const));
    const events:Array<{id:string;code:ReputationBadgeCode;eventType:"EARNED"|"LOST"}>=[];
    for(const code of REPUTATION_BADGE_CODES){
      const before=states.get(code)===true,next=activeCodes.has(code);
      if(before===next){
        if(!states.has(code))await tx.$executeRawUnsafe(`INSERT INTO "ReputationBadgeState" ("userId","badgeCode","active","updatedAt") VALUES ($1,$2,FALSE,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`,userId,code);
        continue;
      }
      const eventType:"EARNED"|"LOST"=next?"EARNED":"LOST";
      await tx.$executeRawUnsafe(`INSERT INTO "ReputationBadgeState" ("userId","badgeCode","active","earnedAt","lostAt","updatedAt") VALUES ($1,$2,$3,CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,CASE WHEN $3 THEN NULL ELSE CURRENT_TIMESTAMP END,CURRENT_TIMESTAMP) ON CONFLICT ("userId","badgeCode") DO UPDATE SET "active"=EXCLUDED."active","earnedAt"=CASE WHEN EXCLUDED."active" THEN CURRENT_TIMESTAMP ELSE "ReputationBadgeState"."earnedAt" END,"lostAt"=CASE WHEN EXCLUDED."active" THEN NULL ELSE CURRENT_TIMESTAMP END,"updatedAt"=CURRENT_TIMESTAMP`,userId,code,next);
      const id=randomUUID();
      await tx.$executeRawUnsafe(`INSERT INTO "ReputationBadgeEvent" ("id","userId","badgeCode","eventType","metadata") VALUES ($1,$2,$3,$4,$5::jsonb)`,id,userId,code,eventType,JSON.stringify(metadata));
      events.push({id,code,eventType});
    }
    await tx.$executeRawUnsafe(`UPDATE "ReputationUserSnapshot" SET "lastEvaluatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1`,userId);
    return {baseline:false,events};
  });
  if(notify&&!result.baseline){
    for(const event of result.events.filter(e=>e.eventType==="EARNED")){
      const badge=BADGES[event.code];
      await deliverUserEvent({userId,eventKind:"LISTING",notificationKind:"SYSTEM",title:`Nouveau badge : ${badge.label}`,body:`Félicitations ! Vous avez obtenu le badge « ${badge.label} ». ${badge.description}`,actionUrl:`/profil/${encodeURIComponent(userId)}`,metadata:{reputationBadgeCode:badge.code,reputationBadgeEventId:event.id},dedupeKey:`reputation-badge-earned:${event.id}`});
    }
  }
  return {...reputation,transition:result};
}

async function reputationCandidateUserIds(limit=300){
  await ensureReputationSchema();
  const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`
    SELECT u."id" FROM "User" u
    LEFT JOIN "ReputationUserSnapshot" rs ON rs."userId"=u."id"
    WHERE u."status"='ACTIVE' AND (
      rs."userId" IS NULL OR u."updatedAt">rs."lastEvaluatedAt"
      OR EXISTS(SELECT 1 FROM "UserProfile" p WHERE p."userId"=u."id" AND p."updatedAt">rs."lastEvaluatedAt")
      OR EXISTS(SELECT 1 FROM "BusinessProfile" b WHERE b."userId"=u."id" AND b."updatedAt">rs."lastEvaluatedAt")
      OR EXISTS(SELECT 1 FROM "Store" s WHERE s."ownerId"=u."id" AND s."updatedAt">rs."lastEvaluatedAt")
      OR EXISTS(SELECT 1 FROM "Conversation" c JOIN "Message" m ON m."conversationId"=c."id" WHERE c."sellerId"=u."id" AND m."createdAt">rs."lastEvaluatedAt")
      OR EXISTS(SELECT 1 FROM "MarketplaceOrder" o WHERE o."sellerId"=u."id" AND o."updatedAt">rs."lastEvaluatedAt")
      OR EXISTS(SELECT 1 FROM "MarketplaceReview" r WHERE r."revieweeId"=u."id" AND r."createdAt">rs."lastEvaluatedAt")
      OR EXISTS(SELECT 1 FROM "MarketplaceShipment" ms JOIN "MarketplaceOrder" mo ON mo."id"=ms."orderId" WHERE mo."sellerId"=u."id" AND ms."shippedAt" IS NOT NULL AND ms."shippedAt">rs."lastEvaluatedAt")
    )
    ORDER BY COALESCE(rs."lastEvaluatedAt",TIMESTAMPTZ '1970-01-01') ASC,u."createdAt" ASC LIMIT $1`,limit);
  return rows.map(row=>row.id);
}

export async function reconcileReputationBadges(limit=300){
  const ids=await reputationCandidateUserIds(limit);let processed=0,earned=0,lost=0,baselined=0;
  for(let i=0;i<ids.length;i+=10){
    const batch=ids.slice(i,i+10);
    const results=await Promise.all(batch.map(id=>syncUserReputation(id).catch(()=>null)));
    for(const result of results){if(!result)continue;processed++;if(result.transition.baseline)baselined++;for(const event of result.transition.events){if(event.eventType==="EARNED")earned++;else lost++;}}
  }
  return {processed,earned,lost,baselined,remaining:ids.length===limit};
}

export function startReputationWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  const intervalMs=Math.max(Number(process.env.REPUTATION_WORKER_INTERVAL_MS??5*60*1000),60_000);let running=false;
  const tick=async()=>{if(running)return;running=true;try{let totals={processed:0,earned:0,lost:0,baselined:0};for(let page=0;page<20;page++){const result=await reconcileReputationBadges();totals={processed:totals.processed+result.processed,earned:totals.earned+result.earned,lost:totals.lost+result.lost,baselined:totals.baselined+result.baselined};if(!result.remaining)break;}if(totals.processed)log?.info(totals,"reputation badges reconciled")}catch(error){log?.error(error,"reputation worker failed")}finally{running=false}};
  void tick();const timer=setInterval(()=>void tick(),intervalMs);timer.unref();return timer;
}


export type ReputationProgressCondition={
  key:string;
  label:string;
  currentLabel:string;
  met:boolean;
  progress:number;
};
export type ReputationBadgeProgress={
  badge:ReputationBadge;
  earned:boolean;
  progress:number;
  conditions:ReputationProgressCondition[];
  nextStep:string|null;
};

function clampProgress(value:number){return Math.max(0,Math.min(100,Math.round(value)))}
function minProgress(conditions:ReputationProgressCondition[]){return conditions.length?Math.min(...conditions.map(c=>c.progress)):0}

export async function getUserReputationDashboard(userId:string){
  const [reputation,history,identityRows]=await Promise.all([
    getUserReputation(userId),
    getReputationBadgeHistory(userId,30),
    prisma.$queryRawUnsafe<Array<{emailVerified:boolean;phoneVerified:boolean;businessVerified:boolean}>>(`SELECT (u."emailVerifiedAt" IS NOT NULL) AS "emailVerified",(p."phoneVerifiedAt" IS NOT NULL) AS "phoneVerified",(COALESCE(b."verificationStatus"='VERIFIED',FALSE) OR EXISTS(SELECT 1 FROM "Store" s WHERE s."ownerId"=u."id" AND s."status"='ACTIVE' AND s."isVerified"=TRUE)) AS "businessVerified" FROM "User" u LEFT JOIN "UserProfile" p ON p."userId"=u."id" LEFT JOIN "BusinessProfile" b ON b."userId"=u."id" WHERE u."id"=$1 LIMIT 1`,userId),
  ]);
  if(!reputation)return null;
  const identity=identityRows[0]??{emailVerified:false,phoneVerified:false,businessVerified:false};
  const m=reputation.metrics,t=reputation.trust,earnedCodes=new Set(reputation.badges.map(b=>b.code));
  const condition=(key:string,label:string,currentLabel:string,met:boolean,progress:number):ReputationProgressCondition=>({key,label,currentLabel,met,progress:clampProgress(progress)});
  const catalog:ReputationBadgeProgress[]=[];
  const profileConditions=[
    condition("professional_verification","Activité professionnelle ou boutique vérifiée",identity.businessVerified?"Vérifiée":"Non vérifiée",identity.businessVerified,identity.businessVerified?100:0),
    condition("email","E-mail vérifié",identity.emailVerified?"Vérifié":"À vérifier",identity.emailVerified,identity.emailVerified?100:0),
    condition("phone","Téléphone vérifié",identity.phoneVerified?"Vérifié":"À vérifier",identity.phoneVerified,identity.phoneVerified?100:0),
  ];
  const profileProgress=identity.businessVerified?100:((Number(identity.emailVerified)+Number(identity.phoneVerified))/2)*100;
  catalog.push({badge:BADGES.PROFILE_VERIFIE,earned:earnedCodes.has("PROFILE_VERIFIE"),progress:clampProgress(profileProgress),conditions:profileConditions,nextStep:identity.businessVerified||identity.emailVerified&&identity.phoneVerified?null:!identity.emailVerified?"Vérifiez votre adresse e-mail.":!identity.phoneVerified?"Vérifiez votre numéro de téléphone.":"Finalisez la vérification de votre profil."});

  const responseConditions=[
    condition("samples","Au moins 3 premières réponses analysées",`${m.responseSamples}/3`,m.responseSamples>=3,(m.responseSamples/3)*100),
    condition("under_2h","Au moins 80 % des premières réponses sous 2 h",m.responseSamples?`${Math.round(m.responseWithinTwoHoursRate*100)} % / 80 %`:"0 % / 80 %",m.responseSamples>=3&&m.responseWithinTwoHoursRate>=.8,(m.responseWithinTwoHoursRate/.8)*100),
    condition("average","Temps de réponse moyen ≤ 2 h",m.averageResponseMinutes==null?"Pas assez de données":`${Math.round(m.averageResponseMinutes)} min / 120 min`,m.responseSamples>=3&&(m.averageResponseMinutes??Infinity)<=120,m.responseSamples<3?clampProgress((m.responseSamples/3)*100):(m.averageResponseMinutes??Infinity)<=120?100:clampProgress(120/(m.averageResponseMinutes??Infinity)*100)),
  ];
  catalog.push({badge:BADGES.REPOND_RAPIDEMENT,earned:earnedCodes.has("REPOND_RAPIDEMENT"),progress:minProgress(responseConditions),conditions:responseConditions,nextStep:m.responseSamples<3?`Encore ${Math.max(0,3-m.responseSamples)} conversation${3-m.responseSamples>1?"s":""} avec réponse à analyser.`:m.responseWithinTwoHoursRate<.8?"Répondez plus souvent en moins de 2 heures.":(m.averageResponseMinutes??Infinity)>120?"Réduisez votre temps de réponse moyen.":null});

  const reliableConditions=[
    condition("trust","Indice de confiance ≥ 75/100",`${t.score}/100`,t.score>=75,(t.score/75)*100),
    condition("sales","Au moins 3 ventes finalisées",`${m.completedSales}/3`,m.completedSales>=3,(m.completedSales/3)*100),
    condition("reviews","Au moins 3 avis vendeur",`${m.reviewCount}/3`,m.reviewCount>=3,(m.reviewCount/3)*100),
    condition("rating","Note moyenne ≥ 4,3/5",m.reviewAverage==null?"Pas encore noté":`${m.reviewAverage.toFixed(1)}/5`,(m.reviewAverage??0)>=4.3,((m.reviewAverage??0)/4.3)*100),
    condition("cancellations","Taux d’annulation ≤ 10 %",`${Math.round(m.cancellationRate*100)} %`,m.cancellationRate<=.1,m.cancellationRate<=.1?100:clampProgress(.1/m.cancellationRate*100)),
    condition("disputes","Taux de litige ≤ 5 %",`${Math.round(m.disputeRate*100)} %`,m.disputeRate<=.05,m.disputeRate<=.05?100:clampProgress(.05/m.disputeRate*100)),
  ];
  const firstReliableMissing=reliableConditions.find(c=>!c.met);
  catalog.push({badge:BADGES.VENDEUR_FIABLE,earned:earnedCodes.has("VENDEUR_FIABLE"),progress:minProgress(reliableConditions),conditions:reliableConditions,nextStep:firstReliableMissing?firstReliableMissing.label:null});

  const shippingConditions=[
    condition("shipments","Au moins 3 expéditions analysées",`${m.shipmentSamples}/3`,m.shipmentSamples>=3,(m.shipmentSamples/3)*100),
    condition("under_48h","Au moins 80 % expédiées sous 48 h",m.shipmentSamples?`${Math.round(m.shipmentWithin48HoursRate*100)} % / 80 %`:"0 % / 80 %",m.shipmentSamples>=3&&m.shipmentWithin48HoursRate>=.8,(m.shipmentWithin48HoursRate/.8)*100),
  ];
  catalog.push({badge:BADGES.EXPEDITION_RAPIDE,earned:earnedCodes.has("EXPEDITION_RAPIDE"),progress:minProgress(shippingConditions),conditions:shippingConditions,nextStep:m.shipmentSamples<3?`Encore ${Math.max(0,3-m.shipmentSamples)} expédition${3-m.shipmentSamples>1?"s":""} à analyser.`:m.shipmentWithin48HoursRate<.8?"Expédiez davantage de commandes sous 48 heures.":null});

  const topConditions=[
    condition("reliable","Badge Vendeur fiable",earnedCodes.has("VENDEUR_FIABLE")?"Obtenu":"À obtenir",earnedCodes.has("VENDEUR_FIABLE"),earnedCodes.has("VENDEUR_FIABLE")?100:catalog.find(x=>x.badge.code==="VENDEUR_FIABLE")?.progress??0),
    condition("responsive","Badge Répond rapidement",earnedCodes.has("REPOND_RAPIDEMENT")?"Obtenu":"À obtenir",earnedCodes.has("REPOND_RAPIDEMENT"),earnedCodes.has("REPOND_RAPIDEMENT")?100:catalog.find(x=>x.badge.code==="REPOND_RAPIDEMENT")?.progress??0),
    condition("sales10","Au moins 10 ventes finalisées",`${m.completedSales}/10`,m.completedSales>=10,(m.completedSales/10)*100),
    condition("reviews5","Au moins 5 avis vendeur",`${m.reviewCount}/5`,m.reviewCount>=5,(m.reviewCount/5)*100),
    condition("rating47","Note moyenne ≥ 4,7/5",m.reviewAverage==null?"Pas encore noté":`${m.reviewAverage.toFixed(1)}/5`,(m.reviewAverage??0)>=4.7,((m.reviewAverage??0)/4.7)*100),
  ];
  const firstTopMissing=topConditions.find(c=>!c.met);
  catalog.push({badge:BADGES.TOP_VENDEUR,earned:earnedCodes.has("TOP_VENDEUR"),progress:minProgress(topConditions),conditions:topConditions,nextStep:firstTopMissing?firstTopMissing.label:null});

  catalog.sort((a,b)=>Number(b.earned)-Number(a.earned)||b.progress-a.progress||b.badge.priority-a.badge.priority);
  return {reputation,history,catalog,summary:{earned:reputation.badges.length,total:catalog.length,overallProgress:clampProgress(catalog.reduce((sum,item)=>sum+item.progress,0)/catalog.length)}};
}
