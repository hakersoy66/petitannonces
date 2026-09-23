import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { deliverUserEvent } from "./notification-delivery.js";
import { activateListingLifetime } from "./listing-lifecycle.js";
import { ensureImportLogTable } from "./import-log.js";
import { recordUserRiskEvent } from "./risk-engine.js";
import { rewardReferralAfterFirstPublishedListing } from "./referrals.js";
import { notifyListingIndexNow } from "./indexnow.js";
import { prepareListingSocialPost } from "./social-growth.js";
import { notifyFollowersForListing } from "./following.js";
import { notifyInstantSavedSearchesForListing } from "./saved-search-alerts.js";

const SESSION_COOKIE = "pa_session";
const MODERATION_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "COMPLIANCE"]);

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function currentUser(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { roles: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  return session.user;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) { reply.code(401).send({ error: "unauthorized" }); return null; }
  return user;
}

async function requireModerator(request: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(request, reply); if (!user) return null;
  if (!user.roles.some((r: { role: string }) => MODERATION_ROLES.has(r.role))) {
    reply.code(403).send({ error: "forbidden" }); return null;
  }
  return user;
}

async function assessListingRisk(listingId: string) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { seller: true },
  });
  if (!listing) return null;

  const signals: Array<{ code: string; weight: number; detail: string }> = [];
  const accountAgeDays = Math.floor((Date.now() - listing.seller.createdAt.getTime()) / 86_400_000);
  if (accountAgeDays < 3) signals.push({ code: "NEW_ACCOUNT", weight: 18, detail: "Compte créé depuis moins de 3 jours" });
  if (!listing.seller.emailVerifiedAt) signals.push({ code: "EMAIL_UNVERIFIED", weight: 20, detail: "Adresse e-mail non vérifiée" });
  if ((listing.priceMinor ?? 0) > 0 && (listing.priceMinor ?? 0) < 500) signals.push({ code: "VERY_LOW_PRICE", weight: 12, detail: "Prix inhabituellement bas" });

  const reports = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "TrustReport" WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('DISMISSED','CLOSED')`, listingId,
  );
  const reportCount = Number(reports[0]?.count ?? 0);
  if (reportCount >= 2) signals.push({ code: "MULTIPLE_REPORTS", weight: Math.min(35, reportCount * 10), detail: `${reportCount} signalements actifs` });

  const text = `${listing.title ?? ""} ${listing.description ?? ""}`.toLowerCase();
  if (["western union", "mandat cash", "telegram uniquement", "paiement hors plateforme", "crypto uniquement"].some((x) => text.includes(x))) {
    signals.push({ code: "OFF_PLATFORM_PAYMENT", weight: 45, detail: "Expression de paiement hors plateforme détectée" });
  }

  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.weight, 0));
  const level = score >= 80 ? "CRITICAL" : score >= 55 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW";
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FraudRiskAssessment" ("id","subjectType","subjectId","score","level","signals","modelVersion") VALUES ($1,'LISTING',$2,$3,$4::"FraudRiskLevel",$5::jsonb,'rules-v1')`,
    randomUUID(), listingId, score, level, JSON.stringify(signals),
  );
  const priority = level === "CRITICAL" ? 100 : level === "HIGH" ? 80 : level === "MEDIUM" ? 60 : 50;
  await prisma.$executeRawUnsafe(
    `UPDATE "ModerationCase" SET "riskScore"=$1,"priority"=GREATEST("priority",$2),"updatedAt"=CURRENT_TIMESTAMP
     WHERE "targetType"='LISTING' AND "targetId"=$3 AND "status" NOT IN ('RESOLVED','CLOSED')`,
    score, priority, listingId,
  );
  return { score, level, signals };
}

async function riskUserForTarget(targetType:string,targetId:string){
  if(targetType==="USER")return targetId;
  if(targetType==="MESSAGE"){const row=await prisma.message.findUnique({where:{id:targetId},select:{senderId:true}});return row?.senderId??null}
  if(targetType==="LISTING"){const row=await prisma.listing.findUnique({where:{id:targetId},select:{sellerId:true}});return row?.sellerId??null}
  if(targetType==="STORE"){const rows=await prisma.$queryRawUnsafe<Array<{ownerId:string}>>(`SELECT "ownerId" FROM "Store" WHERE "id"=$1 LIMIT 1`,targetId);return rows[0]?.ownerId??null}
  return null;
}

export async function registerModerationRoutes(app: FastifyInstance) {
  app.post("/reports", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({
      targetType: z.enum(["LISTING", "USER", "MESSAGE", "STORE"]),
      targetId: z.string().min(1).max(100),
      reason: z.enum(["SCAM", "COUNTERFEIT", "PROHIBITED_ITEM", "HARASSMENT", "SPAM", "MISLEADING", "DUPLICATE", "SAFETY", "OTHER"]),
      details: z.string().trim().max(2000).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });

    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TrustReport" ("id","reporterId","targetType","targetId","reason","details") VALUES ($1,$2,$3::"ReportTargetType",$4,$5::"ReportReason",$6)`,
      id, user.id, parsed.data.targetType, parsed.data.targetId, parsed.data.reason, parsed.data.details ?? null,
    );

    let risk: Awaited<ReturnType<typeof assessListingRisk>> = null;
    if (parsed.data.targetType === "LISTING") risk = await assessListingRisk(parsed.data.targetId);
    const priority = risk?.level === "CRITICAL" ? 100 : risk?.level === "HIGH" ? 80 : risk?.level === "MEDIUM" ? 60 : 40;
    const caseId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ModerationCase" ("id","targetType","targetId","priority","riskScore") VALUES ($1,$2::"ReportTargetType",$3,$4,$5)`,
      caseId, parsed.data.targetType, parsed.data.targetId, priority, risk?.score ?? 0,
    );
    await prisma.$executeRawUnsafe(`INSERT INTO "ModerationCaseReport" ("caseId","reportId") VALUES ($1,$2)`, caseId, id);
    const riskUserId=await riskUserForTarget(parsed.data.targetType,parsed.data.targetId);
    if(riskUserId)await recordUserRiskEvent({userId:riskUserId,eventType:"REPORT_RECEIVED",weight:0,metadata:{reportId:id,targetType:parsed.data.targetType,targetId:parsed.data.targetId,reason:parsed.data.reason}}).catch(()=>undefined);
    return reply.code(201).send({ report: { id, status: "OPEN" }, moderationCaseId: caseId, risk });
  });

  app.post("/trust/assess/listings/:id", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    const risk = await assessListingRisk(parsed.data.id);
    if (!risk) return reply.code(404).send({ error: "listing_not_found" });
    return reply.send({ risk });
  });

  app.get("/admin/moderation/messaging-safety", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "UserBlock" ("id" TEXT PRIMARY KEY,"blockerId" TEXT NOT NULL,"blockedId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "UserBlock_no_self" CHECK ("blockerId" <> "blockedId"))`);
    const reports=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT tr."id",tr."reason",tr."details",tr."status",tr."createdAt",m."id" AS "messageId",m."body",m."conversationId",c."listingId",COALESCE(senderp."displayName",'Membre') AS "senderName",COALESCE(reporterp."displayName",'Membre') AS "reporterName",COALESCE(ctx."context",'[]'::jsonb) AS "context" FROM "TrustReport" tr JOIN "Message" m ON m."id"=tr."targetId" LEFT JOIN "Conversation" c ON c."id"=m."conversationId" LEFT JOIN "UserProfile" senderp ON senderp."userId"=m."senderId" LEFT JOIN "UserProfile" reporterp ON reporterp."userId"=tr."reporterId" LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',q."id",'body',q."body",'kind',q."kind",'senderId',q."senderId",'senderName',COALESCE(qp."displayName",'Membre'),'createdAt',q."createdAt") ORDER BY q."createdAt") AS "context" FROM (SELECT mm."id",mm."body",mm."kind",mm."senderId",mm."createdAt" FROM "Message" mm WHERE mm."conversationId"=m."conversationId" ORDER BY ABS(EXTRACT(EPOCH FROM (mm."createdAt"-m."createdAt"))) ASC LIMIT 9) q LEFT JOIN "UserProfile" qp ON qp."userId"=q."senderId") ctx ON TRUE WHERE tr."targetType"='MESSAGE' ORDER BY tr."createdAt" DESC LIMIT 50`);
    const blocks=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT b."id",b."createdAt",COALESCE(bp."displayName",'Membre') AS "blockerName",COALESCE(tp."displayName",'Membre') AS "blockedName",b."blockerId",b."blockedId" FROM "UserBlock" b LEFT JOIN "UserProfile" bp ON bp."userId"=b."blockerId" LEFT JOIN "UserProfile" tp ON tp."userId"=b."blockedId" ORDER BY b."createdAt" DESC LIMIT 50`);
    return reply.send({reports,blocks,summary:{reports:reports.length,blocks:blocks.length}});
  });

  app.get("/admin/moderation/cases", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "ModerationCase" WHERE "status" NOT IN ('RESOLVED','CLOSED') ORDER BY "priority" DESC, "createdAt" ASC LIMIT 100`,
    );
    return reply.send({ cases: rows });
  });

  app.get("/admin/moderation/listings", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const cases = await prisma.$queryRawUnsafe<Array<{
      id:string; targetId:string; status:string; priority:number; riskScore:number; createdAt:Date; updatedAt:Date;
    }>>(
      `SELECT "id","targetId","status","priority","riskScore","createdAt","updatedAt"
       FROM "ModerationCase"
       WHERE "targetType"='LISTING' AND "status" NOT IN ('RESOLVED','CLOSED')
       ORDER BY "priority" DESC, "createdAt" ASC LIMIT 100`,
    );
    const targetIds = cases.map(item => item.targetId);
    if (!targetIds.length) return reply.send({ listings: [], summary: { pending: 0, highRisk: 0 } });

    const listings = await prisma.listing.findMany({
      where: { id: { in: targetIds }, status: "PENDING" },
      include: {
        category: { select: { name: true, slug: true, domain: true } },
        seller: {
          select: {
            id: true, email: true, kind: true, createdAt: true, emailVerifiedAt: true,
            profile: { select: { displayName: true, firstName: true, lastName: true } },
            business: { select: { tradeName: true, legalName: true, verificationStatus: true } },
          },
        },
      },
    });
    const listingIds = listings.map(item => item.id);
    const media = listingIds.length ? await prisma.$queryRawUnsafe<Array<{listingId:string;publicUrl:string|null}>>(
      `SELECT DISTINCT ON ("listingId") "listingId","publicUrl"
       FROM "ListingMedia"
       WHERE "listingId" = ANY($1::text[]) AND "status"='READY' AND "publicUrl" IS NOT NULL
       ORDER BY "listingId","isCover" DESC,"sortOrder" ASC,"createdAt" ASC`, listingIds,
    ) : [];
    const reportRows = listingIds.length ? await prisma.$queryRawUnsafe<Array<{targetId:string;count:bigint}>>(
      `SELECT "targetId",COUNT(*)::bigint AS "count" FROM "TrustReport"
       WHERE "targetType"='LISTING' AND "targetId" = ANY($1::text[]) AND "status" NOT IN ('DISMISSED','CLOSED')
       GROUP BY "targetId"`, listingIds,
    ) : [];
    await ensureImportLogTable();
    const importRows = listingIds.length ? await prisma.$queryRawUnsafe<Array<{listingId:string;sourceType:string;sourceUrl:string|null;createdAt:Date}>>(`SELECT DISTINCT ON ("listingId") "listingId","sourceType","sourceUrl","createdAt" FROM "ListingImportLog" WHERE "listingId" = ANY($1::text[]) ORDER BY "listingId","createdAt" DESC`,listingIds) : [];
    const promotionRows = listingIds.length ? await prisma.$queryRawUnsafe<Array<{listingId:string;code:string;type:string;name:string;endsAt:Date|null}>>(`SELECT lp."listingId",pp."code",pp."type"::text AS "type",pp."name",lp."endsAt" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."listingId" = ANY($1::text[]) AND lp."status"='ACTIVE' AND (lp."endsAt" IS NULL OR lp."endsAt">CURRENT_TIMESTAMP) ORDER BY lp."createdAt" DESC`,listingIds) : [];
    const coverById = new Map(media.map(item => [item.listingId, item.publicUrl]));
    const reportsById = new Map(reportRows.map(item => [item.targetId, Number(item.count)]));
    const importById = new Map(importRows.map(item => [item.listingId,item]));
    const promotionById = new Map<string,Array<{code:string;type:string;name:string;endsAt:Date|null}>>();
    for(const row of promotionRows){const list=promotionById.get(row.listingId)??[];list.push({code:row.code,type:row.type,name:row.name,endsAt:row.endsAt});promotionById.set(row.listingId,list)}
    const listingById = new Map(listings.map(item => [item.id, item]));

    const queue = cases.flatMap(c => {
      const listing = listingById.get(c.targetId);
      if (!listing) return [];
      const sellerName = listing.seller.business?.tradeName ?? listing.seller.profile?.displayName ?? [listing.seller.profile?.firstName, listing.seller.profile?.lastName].filter(Boolean).join(" ") ?? listing.seller.email;
      return [{
        caseId: c.id, caseStatus: c.status, priority: c.priority, riskScore: c.riskScore,
        submittedAt: c.createdAt, listing: {
          id: listing.id, slug: listing.slug, title: listing.title, description: listing.description,
          priceMinor: listing.priceMinor, currency: listing.currency, city: listing.city, postalCode: listing.postalCode,
          createdAt: listing.createdAt, updatedAt: listing.updatedAt, coverUrl: coverById.get(listing.id) ?? null,
          category: listing.category,
          seller: {
            id: listing.seller.id, email: listing.seller.email, kind: listing.seller.kind,
            name: sellerName || listing.seller.email,
            memberSince: listing.seller.createdAt, emailVerified: Boolean(listing.seller.emailVerifiedAt),
            businessVerified: listing.seller.business?.verificationStatus === "VERIFIED",
          },
          activeReports: reportsById.get(listing.id) ?? 0,
          importSource: importById.get(listing.id) ?? null,
          promotions: promotionById.get(listing.id) ?? [],
        },
      }];
    });
    return reply.send({ listings: queue, summary: { pending: queue.length, highRisk: queue.filter(item => item.riskScore >= 55).length } });
  });

  app.get("/admin/moderation/listings/:id", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_listing" });
    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, status: "PENDING" },
      include: {
        category: true, attributes: { include: { attribute: true } }, vehicle: true, property: true, energy: true,
        seller: { include: { profile: true, business: true, roles: true } },
      },
    });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    const media = await prisma.$queryRawUnsafe<Array<{id:string;publicUrl:string;mimeType:string;altText:string|null;isCover:boolean;sortOrder:number}>>(
      `SELECT "id","publicUrl","mimeType","altText","isCover","sortOrder"
       FROM "ListingMedia" WHERE "listingId"=$1 AND "status"='READY' AND "publicUrl" IS NOT NULL
       ORDER BY "isCover" DESC,"sortOrder" ASC,"createdAt" ASC`, listing.id,
    );
    const reports = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id","reason","details","status","createdAt" FROM "TrustReport"
       WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('DISMISSED','CLOSED')
       ORDER BY "createdAt" DESC LIMIT 20`, listing.id,
    );
    const values = listing.attributes.map(item => ({
      label: item.attribute.label, key: item.attribute.key, unit: item.attribute.unit,
      value: item.valueText ?? item.valueNumber ?? item.valueBoolean ?? item.valueJson,
    }));
    const [sellerListingRows, sellerModerationRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{total:bigint;published:bigint;pending:bigint;suspended:bigint;sold:bigint}>>(
        `SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE "status"='PUBLISHED')::bigint AS published,
                COUNT(*) FILTER (WHERE "status"='PENDING')::bigint AS pending,
                COUNT(*) FILTER (WHERE "status"='SUSPENDED')::bigint AS suspended,
                COUNT(*) FILTER (WHERE "status"='SOLD')::bigint AS sold
         FROM "Listing" WHERE "sellerId"=$1`, listing.sellerId,
      ),
      prisma.$queryRawUnsafe<Array<{approved:bigint;rejected:bigint}>>(
        `SELECT COUNT(*) FILTER (WHERE mc."decisionAction"='NONE')::bigint AS approved,
                COUNT(*) FILTER (WHERE mc."decisionAction" IS NOT NULL AND mc."decisionAction"<>'NONE')::bigint AS rejected
         FROM "ModerationCase" mc
         JOIN "Listing" l ON l."id"=mc."targetId"
         WHERE mc."targetType"='LISTING' AND l."sellerId"=$1 AND mc."status" IN ('RESOLVED','CLOSED')`, listing.sellerId,
      ),
    ]);
    const sellerListings=sellerListingRows[0]; const sellerModeration=sellerModerationRows[0];
    return reply.send({ listing: {
      id: listing.id, slug: listing.slug, title: listing.title, description: listing.description,
      priceMinor: listing.priceMinor, currency: listing.currency, city: listing.city, postalCode: listing.postalCode,
      region: listing.region, latitude: listing.latitude, longitude: listing.longitude,
      category: { name: listing.category.name, slug: listing.category.slug, domain: listing.category.domain },
      attributes: values, vehicle: listing.vehicle, property: listing.property, energy: listing.energy,
      media: media.map(item => ({ ...item, url: item.publicUrl })), reports,
      seller: {
        id: listing.seller.id, email: listing.seller.email, kind: listing.seller.kind,
        name: listing.seller.business?.tradeName ?? listing.seller.profile?.displayName ?? ([listing.seller.profile?.firstName, listing.seller.profile?.lastName].filter(Boolean).join(" ") || listing.seller.email),
        memberSince: listing.seller.createdAt, emailVerified: Boolean(listing.seller.emailVerifiedAt),
        businessVerified: listing.seller.business?.verificationStatus === "VERIFIED",
        stats:{
          total:Number(sellerListings?.total??0n),published:Number(sellerListings?.published??0n),pending:Number(sellerListings?.pending??0n),suspended:Number(sellerListings?.suspended??0n),sold:Number(sellerListings?.sold??0n),
          approved:Number(sellerModeration?.approved??0n),rejected:Number(sellerModeration?.rejected??0n),
        },
      },
    }});
  });

  app.post("/admin/moderation/cases/:id/decision", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({
      action: z.enum(["NONE","WARNING","HIDE_LISTING","SUSPEND_LISTING","REMOVE_LISTING","SUSPEND_USER","BAN_USER","RESTRICT_MESSAGING","STORE_SUSPEND"]),
      reasonCode: z.string().trim().min(2).max(120),
      statement: z.string().trim().min(10).max(3000),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const cases = await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ModerationCase" WHERE "id"=$1 LIMIT 1`, params.data.id);
    const c = cases[0]; if (!c) return reply.code(404).send({ error: "case_not_found" });
    if (body.data.action === "NONE" && c.targetType === "LISTING") {
      const currentListing=await prisma.listing.findUnique({where:{id:c.targetId},select:{publishedAt:true,sellerId:true}});
      const firstPublication=currentListing?.publishedAt==null;
      const publishedAt = currentListing?.publishedAt ?? new Date();
      const published = await prisma.listing.updateMany({ where: { id: c.targetId, status: "PENDING" }, data: { status: "PUBLISHED", publishedAt } });
      if (published.count) {
        await activateListingLifetime(c.targetId, publishedAt);
        if(currentListing?.sellerId)await rewardReferralAfterFirstPublishedListing(currentListing.sellerId).catch(error=>request.log.warn({error,userId:currentListing.sellerId},"referral reward failed after moderation approval"));
        await notifyListingIndexNow(c.targetId).catch(error=>request.log.warn({error,listingId:c.targetId},"indexnow notification failed after moderation approval"));
        await prepareListingSocialPost(c.targetId).catch(error=>request.log.warn({error,listingId:c.targetId},"social post preparation failed after moderation approval"));
        if(firstPublication){
          await notifyFollowersForListing(c.targetId).catch(error=>request.log.warn({error,listingId:c.targetId},"follower notification failed after moderation approval"));
          await notifyInstantSavedSearchesForListing(c.targetId).catch(error=>request.log.warn({error,listingId:c.targetId},"instant saved-search notification failed after moderation approval"));
        }
      }
    }
    if (["HIDE_LISTING","SUSPEND_LISTING","REMOVE_LISTING"].includes(body.data.action) && c.targetType === "LISTING") {
      await prisma.listing.updateMany({ where: { id: c.targetId }, data: { status: "SUSPENDED" } });
    }
    if (["SUSPEND_USER","BAN_USER"].includes(body.data.action) && c.targetType === "USER") {
      await prisma.user.updateMany({ where: { id: c.targetId }, data: { status: "SUSPENDED" } });
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "ModerationCase" SET "status"='RESOLVED',"decisionAction"=$1::"ModerationActionType","decisionReasonCode"=$2,"decisionStatement"=$3,"decidedByUserId"=$4,"decidedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$5`,
      body.data.action, body.data.reasonCode, body.data.statement, moderator.id, c.id,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ModerationActionLog" ("id","caseId","actorUserId","action","reasonCode","statement") VALUES ($1,$2,$3,$4::"ModerationActionType",$5,$6)`,
      randomUUID(), c.id, moderator.id, body.data.action, body.data.reasonCode, body.data.statement,
    );
    if (c.targetType === "LISTING") {
      const listing = await prisma.listing.findUnique({ where: { id: c.targetId }, select: { id:true, title:true, slug:true, sellerId:true } });
      if (listing) {
        const approved = body.data.action === "NONE";
        const title = approved ? "Votre annonce est en ligne" : "Votre annonce nécessite une modification";
        const notificationBody = approved ? `Votre annonce « ${listing.title ?? "Sans titre"} » a été validée et publiée.` : `Votre annonce « ${listing.title ?? "Sans titre"} » nécessite votre attention. Motif : ${body.data.statement}`;
        const actionUrl = approved && listing.slug ? `/annonce/${encodeURIComponent(listing.slug)}` : `/deposer-une-annonce?listingId=${encodeURIComponent(listing.id)}`;
        const metadata = { purpose:"LISTING_MODERATION", listingId:listing.id, approved, reasonCode:body.data.reasonCode };
        await deliverUserEvent({userId:listing.sellerId,eventKind:"LISTING",notificationKind:"LISTING",title,body:notificationBody,actionUrl,metadata});
      }
    }
    return reply.send({ resolved: true });
  });

  app.post("/moderation/cases/:id/appeals", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ statement: z.string().trim().min(20).max(4000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ModerationAppeal" ("id","caseId","appellantUserId","statement") VALUES ($1,$2,$3,$4)`, id, params.data.id, user.id, body.data.statement,
    );
    return reply.code(201).send({ appeal: { id, status: "OPEN" } });
  });

  app.post("/admin/moderation/appeals/:id/review", async (request, reply) => {
    const moderator = await requireModerator(request, reply); if (!moderator) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ status: z.enum(["UPHELD","OVERTURNED","PARTIALLY_OVERTURNED"]), resolutionNote: z.string().trim().min(10).max(3000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(
      `UPDATE "ModerationAppeal" SET "status"=$1::"AppealStatus","reviewedByUserId"=$2,"resolutionNote"=$3,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4`,
      body.data.status, moderator.id, body.data.resolutionNote, params.data.id,
    );
    return reply.send({ reviewed: true, status: body.data.status });
  });
}
