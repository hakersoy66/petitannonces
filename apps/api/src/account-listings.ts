import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { expireDueListings, getListingLifecycles, LISTING_LIFETIME_DAYS, LISTING_RENEWAL_COST_MINOR, LISTING_RENEWAL_CURRENCY, LISTING_RENEWAL_WINDOW_DAYS, isListingRenewable, renewExpiredListing } from "./listing-lifecycle.js";
import { hiddenEditWorkingIds } from "./listing-edit-session.js";
import { resolveProfessionalContext } from "./pro-suite.js";
import { deleteStoredObject } from "./storage.js";
import { listingIndexUrls, notifyListingIndexNow, submitIndexNow } from "./indexnow.js";

const statusSchema = z.enum(["DRAFT", "PENDING", "PUBLISHED", "SUSPENDED", "SOLD", "EXPIRED"]);
const idParams = z.object({ id: z.string().min(1) });

// Limit campaign enrollment to material-goods branches, including their subcategories.
// This excludes property, vehicles, jobs, services, animals and travel.
const blackFridayRoots2026=[
  "high-tech","maison-jardin","mode","sports-loisirs","enfants-bebe",
  "materiel-professionnel","agriculture","culture-billetterie",
];
async function blackFridayEligibleCategoryIds(){
  const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(
    `WITH RECURSIVE goods AS (
       SELECT "id" FROM "Category" WHERE "slug"=ANY($1::text[])
       UNION ALL
       SELECT c."id" FROM "Category" c JOIN goods g ON c."parentId"=g."id"
     ) SELECT DISTINCT "id" FROM goods`,
    blackFridayRoots2026,
  );
  return new Set(rows.map(row=>row.id));
}


async function resolveListingSellerId(userId:string,reply:FastifyReply){
  const ctx=await resolveProfessionalContext(userId);
  if(!ctx)return userId;
  if(!ctx.permissions.includes("LISTINGS")){reply.code(403).send({error:"professional_permission_required",permission:"LISTINGS",role:ctx.role});return null}
  return ctx.ownerUserId;
}


function performanceScore(input:{views30:number;favorites:number;messages:number;offers:number}){
  const traffic=Math.min(40,Math.round(Math.log10(input.views30+1)*18));
  const interest=Math.min(25,input.favorites*5);
  const contact=Math.min(25,input.messages*3);
  const intent=Math.min(10,input.offers*5);
  const score=Math.min(100,traffic+interest+contact+intent);
  const level=score>=70?"FORTE":score>=40?"CORRECTE":"FAIBLE";
  return {score,level};
}
function performanceActions(id:string,m:{views30:number;favorites:number;messages:number;offers:number}){
  const out:Array<{code:string;label:string;href:string}> = [];
  if(m.views30<10)out.push({code:"VISIBILITY",label:"Améliorer la visibilité",href:`/espace-pro/visibilite?listingId=${encodeURIComponent(id)}`});
  if(m.views30>=20&&m.messages===0)out.push({code:"CONTENT",label:"Améliorer le titre et la description",href:`/deposer-une-annonce?listingId=${encodeURIComponent(id)}&resumeStep=2`});
  if(m.favorites>=3&&m.offers===0)out.push({code:"PRICE",label:"Revoir le prix",href:`/deposer-une-annonce?listingId=${encodeURIComponent(id)}&resumeStep=3`});
  if(!out.length)out.push({code:"DETAIL",label:"Voir la performance",href:`/annonce/${encodeURIComponent(id)}`});
  return out.slice(0,2);
}
function listingQuality(input:{title:string|null;description:string|null;priceMinor:number|null;city:string|null;postalCode:string|null;photoCount:number}){
  let score=0;
  const issues:Array<{code:string;label:string;step:number}> = [];
  const title=(input.title??"").trim();
  const description=(input.description??"").trim();
  if(title.length>=15)score+=20;else issues.push({code:"TITLE",label:"Enrichir le titre",step:0});
  if(description.length>=120)score+=25;else issues.push({code:"DESCRIPTION",label:"Compléter la description",step:2});
  if(input.priceMinor!==null)score+=15;else issues.push({code:"PRICE",label:"Ajouter un prix",step:3});
  if(input.city&&input.postalCode)score+=15;else issues.push({code:"LOCATION",label:"Compléter la localisation",step:2});
  if(input.photoCount>=5)score+=25;else if(input.photoCount>=1){score+=12;issues.push({code:"PHOTOS",label:"Ajouter au moins 5 photos",step:1})}else issues.push({code:"PHOTOS",label:"Ajouter des photos",step:1});
  const level=score>=85?"EXCELLENT":score>=65?"BON":"A_AMELIORER";
  return{score,level,photoCount:input.photoCount,issues};
}

const transitions: Record<string, string[]> = {
  DRAFT: [],
  PENDING: [],
  PUBLISHED: ["SUSPENDED", "SOLD"],
  SUSPENDED: ["PENDING"],
  SOLD: [],
  EXPIRED: [],
};

export async function registerAccountListingRoutes(app: FastifyInstance) {
  // Black Friday 2026 is a curated listing selection, NOT a claimed price reduction.
  // No strikethrough prices or discount percentages are published without a verified 30-day price history.
  app.get("/public/black-friday", async (_request, reply) => {
    const now = Date.now();
    const start = Date.parse("2026-11-19T23:00:00.000Z"); // 20 November, 00:00 Europe/Paris
    const end = Date.parse("2026-11-30T23:00:00.000Z"); // 1 December, 00:00 Europe/Paris
    const phase = now < start ? "upcoming" : now >= end ? "ended" : "active";
    if (phase !== "active") return reply.send({ campaign: "BLACK_FRIDAY_2026", phase, items: [], total: 0 });
    const listings = await prisma.$queryRawUnsafe<Array<{
      id:string;slug:string;title:string;priceMinor:number;currency:string;city:string|null;
      categoryName:string;categorySlug:string;enrolledAt:Date;imageUrl:string|null;publishedAt:Date|null;
    }>>(`
      SELECT l."id",l."slug",l."title",l."priceMinor",l."currency",l."city",l."publishedAt",
             c."name" AS "categoryName",c."slug" AS "categorySlug",
             bf."enrolledAt", photo."publicUrl" AS "imageUrl"
      FROM "BlackFridayEntry2026" bf
      JOIN "Listing" l ON l."id"=bf."listingId"
      JOIN "Category" c ON c."id"=l."categoryId"
      JOIN "User" u ON u."id"=l."sellerId"
      LEFT JOIN LATERAL (
        SELECT lm."publicUrl" FROM "ListingMedia" lm
        WHERE lm."listingId"=l."id" AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL
        ORDER BY lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC LIMIT 1
      ) photo ON TRUE
      WHERE l."status"='PUBLISHED' AND l."slug" IS NOT NULL
        AND l."priceMinor">0 AND l."currency"='EUR'
        AND c."domain"='GENERAL' AND u."status"='ACTIVE'
      ORDER BY bf."enrolledAt" DESC LIMIT 60
    `);
    const history= listings.length?await prisma.$queryRawUnsafe<Array<{
      listingId:string;oldPriceMinor:number;newPriceMinor:number;changedAt:Date;
    }>>(
      'SELECT "listingId","oldPriceMinor","newPriceMinor","changedAt" FROM "ListingPriceHistory" WHERE "listingId"=ANY($1::text[]) AND "changedAt" > CURRENT_TIMESTAMP - INTERVAL \'65 days\' ORDER BY "listingId","changedAt" ASC',
      listings.map(item=>item.id)
    ):[];
    const historyByListing=new Map<string,typeof history>();
    for(const row of history){
      const rows=historyByListing.get(row.listingId)??[];
      rows.push(row);historyByListing.set(row.listingId,rows);
    }
    function priorPriceLowest30Days(item:(typeof listings)[number]){
      const changes=historyByListing.get(item.id)??[];
      const last=changes[changes.length-1];
      if(!last||last.newPriceMinor!==item.priceMinor||last.newPriceMinor>=last.oldPriceMinor)return null;
      const threshold=last.changedAt.getTime()-30*86400_000;
      // Require an unbroken 30-day listing history and price-change audit.
      if(!item.publishedAt||item.publishedAt.getTime()>threshold
        ||last.changedAt.getTime()<Date.parse("2026-10-10T00:00:00Z"))return null;
      const window=changes.filter(change=>change.changedAt.getTime()>=threshold&&change.changedAt<=last.changedAt);
      if(!window.length)return null;
      const previous=window.flatMap(change=>[
        change.oldPriceMinor,
        ...(change===last?[]:[change.newPriceMinor]),
      ]);
      const lowest=Math.min(...previous);
      if(!Number.isSafeInteger(lowest)||lowest<=item.priceMinor||lowest<=0)return null;
      // Reference represents the lowest recorded price before the latest reduction.
      return lowest;
    }
    reply.header("cache-control", "public, max-age=60");
    return reply.send({
      campaign: "BLACK_FRIDAY_2026", phase, total: listings.length,
      items: listings.map(item=>({
        id:item.id,slug:item.slug,title:item.title,priceMinor:item.priceMinor,
        currency:item.currency,city:item.city,imageUrl:item.imageUrl,
        referencePriceMinor:priorPriceLowest30Days(item),
        category:{name:item.categoryName,slug:item.categorySlug},
      })),
    });
  });

  app.post("/account/listings/:id/black-friday", async (request, reply) => {
    const user=await requireListingUser(request,reply);if(!user)return;
    const sellerId=await resolveListingSellerId(user.id,reply);if(!sellerId)return;
    const params=idParams.safeParse(request.params);
    const body=z.object({participate:z.boolean()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    if(body.data.participate&&Date.now()>=Date.parse("2026-11-30T23:00:00.000Z"))
      return reply.code(409).send({error:"campaign_ended"});
    const listing=await prisma.listing.findFirst({
      where:{id:params.data.id,sellerId},
      select:{id:true,status:true,slug:true,priceMinor:true,currency:true,category:{select:{id:true,domain:true,slug:true}}},
    });
    if(!listing)return reply.code(404).send({error:"listing_not_found"});
    if(body.data.participate){
      const eligibleCategories=await blackFridayEligibleCategoryIds();
      if(listing.status!=="PUBLISHED"||!listing.slug||listing.priceMinor===null||listing.priceMinor<=0||
        listing.currency!=="EUR"||listing.category.domain!=="GENERAL"||
        !eligibleCategories.has(listing.category.id))
        return reply.code(409).send({error:"listing_not_eligible"});
      await prisma.$executeRawUnsafe(`
        INSERT INTO "BlackFridayEntry2026" ("listingId","sellerId")
        VALUES ($1,$2) ON CONFLICT ("listingId") DO NOTHING
      `,listing.id,sellerId);
    }else{
      await prisma.$executeRawUnsafe(`DELETE FROM "BlackFridayEntry2026" WHERE "listingId"=$1 AND "sellerId"=$2`,listing.id,sellerId);
    }
    return reply.send({participating:body.data.participate,campaign:"BLACK_FRIDAY_2026"});
  });

  app.get("/account/listings", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const sellerId=await resolveListingSellerId(user.id,reply);
    if(!sellerId)return;
    await expireDueListings();

    const query = z.object({ status: statusSchema.optional(), q: z.string().trim().max(100).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });

    const hiddenWorkingIds=await hiddenEditWorkingIds(sellerId);
    const baseWhere:any={sellerId,OR:[{status:{not:"DRAFT"}},{draftSavedAt:{not:null}}],...(hiddenWorkingIds.length?{id:{notIn:hiddenWorkingIds}}:{})};
    const [listings, statusGroups] = await Promise.all([prisma.listing.findMany({
      where: {
        ...baseWhere,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.q ? { title: { contains: query.data.q, mode: "insensitive" } } : {}),
      },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        priceMinor: true,
        currency: true,
        city: true,
        postalCode: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        category: { select: { id: true, name: true, slug: true, domain: true } },
        property: { select: { transactionType: true } },
        store: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }), prisma.listing.groupBy({by:["status"],where:baseWhere,_count:{_all:true}})]);

    const statusCounts:Record<string,number>={ALL:0,DRAFT:0,PENDING:0,PUBLISHED:0,SUSPENDED:0,SOLD:0,EXPIRED:0};
    for(const row of statusGroups){statusCounts[row.status]=row._count._all;statusCounts.ALL=(statusCounts.ALL??0)+row._count._all}
    const ids = listings.map((listing) => listing.id);
    const blackFridayRows=ids.length?await prisma.$queryRawUnsafe<Array<{listingId:string}>>(
      `SELECT "listingId" FROM "BlackFridayEntry2026" WHERE "listingId"=ANY($1::text[])`,ids
    ):[];
    const blackFridayIds=new Set(blackFridayRows.map(row=>row.listingId));
    const blackFridayEligibleCategories=await blackFridayEligibleCategoryIds();
    const [mediaRows, mediaCountRows, moderationRows, lifecycleRows, promotionRows] = await Promise.all([
      ids.length ? prisma.$queryRawUnsafe<Array<{ listingId:string; publicUrl:string }>>(`SELECT DISTINCT ON (lm."listingId") lm."listingId",lm."publicUrl" FROM "ListingMedia" lm WHERE lm."listingId" = ANY($1::text[]) AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL ORDER BY lm."listingId",lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC`, ids) : [],
      ids.length ? prisma.$queryRawUnsafe<Array<{listingId:string;count:bigint}>>(`SELECT "listingId",COUNT(*)::bigint AS count FROM "ListingMedia" WHERE "listingId"=ANY($1::text[]) AND "status"='READY' GROUP BY "listingId"`,ids) : [],
      ids.length ? prisma.$queryRawUnsafe<Array<{listingId:string;caseId:string;status:string;decisionAction:string|null;reasonCode:string|null;statement:string|null;decidedAt:Date|null}>>(`SELECT DISTINCT ON (mc."targetId") mc."targetId" AS "listingId",mc."id" AS "caseId",mc."status"::text,mc."decisionAction"::text AS "decisionAction",mc."decisionReasonCode" AS "reasonCode",mc."decisionStatement" AS "statement",mc."decidedAt" FROM "ModerationCase" mc WHERE mc."targetType"='LISTING' AND mc."targetId" = ANY($1::text[]) ORDER BY mc."targetId",mc."createdAt" DESC`, ids) : [],
      getListingLifecycles(ids),
      ids.length ? prisma.$queryRawUnsafe<Array<{listingId:string;id:string;code:string;type:string;name:string;startsAt:Date|null;endsAt:Date|null;status:string}>>(`SELECT lp."listingId",lp."id",pp."code",pp."type"::text AS "type",pp."name",lp."startsAt",lp."endsAt",lp."status"::text AS "status" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."listingId"=ANY($1::text[]) AND lp."status"='ACTIVE' AND (lp."endsAt" IS NULL OR lp."endsAt">CURRENT_TIMESTAMP) ORDER BY lp."createdAt" DESC`,ids) : [],
    ]);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingView" ("id" text PRIMARY KEY,"listingId" text NOT NULL,"visitorHash" text NOT NULL,"viewedOn" date NOT NULL DEFAULT CURRENT_DATE,"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const listingIdsForViews=listings.map(x=>x.id);
    const viewRows=listingIdsForViews.length?await prisma.$queryRawUnsafe<Array<{listingId:string;count:bigint}>>(`SELECT "listingId",COUNT(*)::bigint AS "count" FROM "ListingView" WHERE "listingId" = ANY($1::text[]) GROUP BY "listingId"`,listingIdsForViews):[];
    const viewCountsByListing=new Map(viewRows.map(x=>[x.listingId,Number(x.count)] as const));
    const metricRows=listingIdsForViews.length?await prisma.$queryRawUnsafe<Array<{listingId:string;favorites:bigint;conversations:bigint;messages:bigint;offers:bigint;views7:bigint;views30:bigint}>>(`
      SELECT l."id" AS "listingId",
        (SELECT COUNT(*)::bigint FROM "FavoriteListing" f WHERE f."listingId"=l."id") AS favorites,
        (SELECT COUNT(*)::bigint FROM "Conversation" c WHERE c."listingId"=l."id") AS conversations,
        (SELECT COUNT(*)::bigint FROM "Message" m JOIN "Conversation" c2 ON c2."id"=m."conversationId" WHERE c2."listingId"=l."id") AS messages,
        (SELECT COUNT(*)::bigint FROM "Offer" o WHERE o."listingId"=l."id") AS offers,
        (SELECT COUNT(*)::bigint FROM "ListingView" v WHERE v."listingId"=l."id" AND v."createdAt">=NOW()-INTERVAL '7 days') AS "views7",
        (SELECT COUNT(*)::bigint FROM "ListingView" v WHERE v."listingId"=l."id" AND v."createdAt">=NOW()-INTERVAL '30 days') AS "views30"
      FROM "Listing" l WHERE l."id" = ANY($1::text[])`,listingIdsForViews):[];
    const metricsByListing=new Map(metricRows.map(x=>[x.listingId,{favorites:Number(x.favorites),conversations:Number(x.conversations),messages:Number(x.messages),offers:Number(x.offers),views7:Number(x.views7),views30:Number(x.views30)}] as const));
    const mediaByListing = new Map(mediaRows.map((row) => [row.listingId, row.publicUrl] as const));
    const mediaCountByListing = new Map(mediaCountRows.map((row)=>[row.listingId,Number(row.count)] as const));
    const moderationByListing = new Map(moderationRows.map((row) => [row.listingId, {caseId:row.caseId,status:row.status,decisionAction:row.decisionAction,reasonCode:row.reasonCode,statement:row.statement,decidedAt:row.decidedAt}] as const));
    const lifecycleByListing = new Map(lifecycleRows.map((row) => [row.listingId, row] as const));
    const promotionsByListing=new Map<string,typeof promotionRows>(); for(const row of promotionRows){const list=promotionsByListing.get(row.listingId)??[];list.push(row);promotionsByListing.set(row.listingId,list)}
    return reply.send({
      listings: listings.map((listing) => {
        const lifecycle = lifecycleByListing.get(listing.id) ?? null;
        return {
          ...listing,
          imageUrl: mediaByListing.get(listing.id) ?? null,
          blackFriday2026: blackFridayIds.has(listing.id),
          blackFridayEligible2026:listing.status==="PUBLISHED"&&Boolean(listing.slug)&&
            listing.currency==="EUR"&&Number(listing.priceMinor)>0&&
            blackFridayEligibleCategories.has(listing.category.id),
          quality: listingQuality({title:listing.title,description:listing.description,priceMinor:listing.priceMinor,city:listing.city,postalCode:listing.postalCode,photoCount:mediaCountByListing.get(listing.id)??0}),
          viewCount: viewCountsByListing.get(listing.id) ?? 0,
          performance: (()=>{const m=metricsByListing.get(listing.id) ?? {favorites:0,conversations:0,messages:0,offers:0,views7:0,views30:0};return {...m,...performanceScore(m),actions:performanceActions(listing.id,m)}})(),
          moderation: moderationByListing.get(listing.id) ?? null,
          promotions:(promotionsByListing.get(listing.id)??[]).map(p=>({id:p.id,code:p.code,type:p.type,name:p.name,startsAt:p.startsAt,endsAt:p.endsAt,status:p.status})),
          lifecycle: lifecycle ? {
            expiresAt: lifecycle.expiresAt,
            renewalRequired: lifecycle.isExpired && ["DRAFT","EXPIRED"].includes(listing.status),
            renewalAvailable: isListingRenewable(listing.status,lifecycle.expiresAt),
            freeRenewalAvailable: !lifecycle.freeRenewalUsed,
            renewalCount: lifecycle.renewalCount,
            renewalCostMinor: lifecycle.freeRenewalUsed ? LISTING_RENEWAL_COST_MINOR : 0,
            renewalCurrency: LISTING_RENEWAL_CURRENCY,
            lifetimeDays: LISTING_LIFETIME_DAYS,
          } : null,
        };
      }),
      counts: statusCounts,
      renewalPolicy: { lifetimeDays: LISTING_LIFETIME_DAYS, earlyRenewalDays: LISTING_RENEWAL_WINDOW_DAYS, firstRenewalFree: true, subsequentRenewalCostMinor: LISTING_RENEWAL_COST_MINOR, currency: LISTING_RENEWAL_CURRENCY },
    });
  });

  app.get("/account/listings/:id/performance", async (request, reply) => {
    const user=await requireListingUser(request,reply); if(!user)return;
    const sellerId=await resolveListingSellerId(user.id,reply); if(!sellerId)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params); if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const listing=await prisma.listing.findFirst({where:{id:params.data.id,sellerId},select:{id:true,status:true}});
    if(!listing)return reply.code(404).send({error:"listing_not_found"});
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ListingView" ("id" text PRIMARY KEY,"listingId" text NOT NULL,"visitorHash" text NOT NULL,"viewedOn" date NOT NULL DEFAULT CURRENT_DATE,"createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const rows=await prisma.$queryRawUnsafe<Array<{views:bigint;views7:bigint;views30:bigint;favorites:bigint;conversations:bigint;messages:bigint;offers:bigint}>>(`SELECT
      (SELECT COUNT(*)::bigint FROM "ListingView" WHERE "listingId"=$1) AS views,
      (SELECT COUNT(*)::bigint FROM "ListingView" WHERE "listingId"=$1 AND "createdAt">=NOW()-INTERVAL '7 days') AS "views7",
      (SELECT COUNT(*)::bigint FROM "ListingView" WHERE "listingId"=$1 AND "createdAt">=NOW()-INTERVAL '30 days') AS "views30",
      (SELECT COUNT(*)::bigint FROM "FavoriteListing" WHERE "listingId"=$1) AS favorites,
      (SELECT COUNT(*)::bigint FROM "Conversation" WHERE "listingId"=$1) AS conversations,
      (SELECT COUNT(*)::bigint FROM "Message" m JOIN "Conversation" c ON c."id"=m."conversationId" WHERE c."listingId"=$1) AS messages,
      (SELECT COUNT(*)::bigint FROM "Offer" WHERE "listingId"=$1) AS offers`,listing.id);
    const x=rows[0];
    const metrics={views:Number(x?.views??0n),views7:Number(x?.views7??0n),views30:Number(x?.views30??0n),favorites:Number(x?.favorites??0n),conversations:Number(x?.conversations??0n),messages:Number(x?.messages??0n),offers:Number(x?.offers??0n)};
    const insight=metrics.views30>=20&&metrics.conversations===0?"Votre annonce est vue mais génère peu de contacts. Vérifiez le prix, les photos et la description.":metrics.views30<10?"La visibilité est encore faible. Ajoutez des photos de qualité et complétez tous les détails.":metrics.favorites>=3&&metrics.offers===0?"Votre annonce plaît : plusieurs membres l’ont ajoutée en favori. Un ajustement du prix peut déclencher des offres.":"Les signaux de performance sont équilibrés. Continuez à répondre rapidement aux messages.";
    const trendRows=await prisma.$queryRawUnsafe<Array<{day:Date;views:bigint}>>(`SELECT DATE_TRUNC('day',"createdAt") AS day,COUNT(*)::bigint AS views FROM "ListingView" WHERE "listingId"=$1 AND "createdAt">=NOW()-INTERVAL '30 days' GROUP BY 1 ORDER BY 1`,listing.id);
    return reply.send({metrics,insight,performance:performanceScore(metrics),actions:performanceActions(listing.id,metrics),series:trendRows.map(r=>({day:r.day.toISOString().slice(0,10),views:Number(r.views)}))});
  });

  app.post("/account/listings/:id/status", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const sellerId=await resolveListingSellerId(user.id,reply);
    if(!sellerId)return;
    const params = idParams.safeParse(request.params);
    const body = z.object({ status: statusSchema }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    if (!transitions[listing.status]?.includes(body.data.status)) return reply.code(409).send({ error: "invalid_status_transition", from: listing.status, to: body.data.status });

    const updated = await prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: body.data.status,
        ...(body.data.status === "PENDING" ? { slug: null } : {}),
      },
      select: { id: true, status: true, slug: true, updatedAt: true },
    });
    if(listing.status==="PUBLISHED")await notifyListingIndexNow(updated.id,true).catch(error=>request.log.warn({error,listingId:updated.id,status:updated.status},"indexnow notification failed after listing status change"));
    return reply.send({ listing: updated });
  });

  app.post("/account/listings/:id/renew", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const sellerId=await resolveListingSellerId(user.id,reply);
    if(!sellerId)return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const renewal = await renewExpiredListing(params.data.id, sellerId);
      return reply.send({ renewed: true, renewal });
    } catch (error) {
      const code = error instanceof Error ? error.message : "listing_renewal_failed";
      if (code === "listing_not_found") return reply.code(404).send({ error: code });
      if (code === "listing_not_expired") return reply.code(409).send({ error: code });
      if (code === "animal_cession_requires_cda_production_validation") return reply.code(423).send({ error: code });
      if (code === "listing_renewal_payment_required") return reply.code(402).send({ error: code, amountMinor: LISTING_RENEWAL_COST_MINOR, currency: LISTING_RENEWAL_CURRENCY });
      request.log.error({ error }, "listing renewal failed");
      return reply.code(500).send({ error: "listing_renewal_failed" });
    }
  });

  app.delete("/account/listings/:id", async (request, reply) => {
    const user = await requireListingUser(request, reply);
    if (!user) return;
    const sellerId=await resolveListingSellerId(user.id,reply);
    if(!sellerId)return;
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });

    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId }, select:{id:true,title:true,status:true} });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });

    const orders = await prisma.$queryRawUnsafe<Array<{count:number}>>(`SELECT COUNT(*)::int AS count
      FROM "MarketplaceOrder" o
      WHERE o."listingId"=$1
        AND (
          o."paidAt" IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM "MarketplacePayment" mp
            WHERE mp."orderId"=o."id"
              AND mp."status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
          )
        )`, listing.id);
    if (Number(orders[0]?.count ?? 0) > 0) {
      return reply.code(409).send({
        error: "listing_has_orders",
        message: "Cette annonce possède un historique de commande et ne peut pas être supprimée définitivement.",
      });
    }

    const [media,indexUrls] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{objectKey:string}>>(`SELECT "objectKey" FROM "ListingMedia" WHERE "listingId"=$1`, listing.id).catch(()=>[]),
      listingIndexUrls(listing.id,true).catch(()=>[]),
    ]);
    await prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`DELETE FROM "ListingImportLog" WHERE "listingId"=$1`,listing.id).catch(()=>undefined);
      await tx.listing.delete({ where: { id: listing.id } });
    });
    for (const item of media) void deleteStoredObject(item.objectKey).catch(()=>undefined);
    if(indexUrls.length)await submitIndexNow(indexUrls).catch(error=>request.log.warn({error,listingId:listing.id},"indexnow notification failed after listing deletion"));
    return reply.send({ deleted:true, id:listing.id });
  });
}
