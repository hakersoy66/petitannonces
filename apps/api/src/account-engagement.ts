import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { deliverUserEvent } from "./notification-delivery.js";

const savedSearchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  query: z.string().trim().max(160).optional().nullable(),
  categorySlug: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(16).optional().nullable(),
  minPriceMinor: z.number().int().nonnegative().optional().nullable(),
  maxPriceMinor: z.number().int().nonnegative().optional().nullable(),
  filters: z.record(z.string(), z.unknown()).optional().nullable(),
  alertEnabled: z.boolean().default(true),
  frequency: z.enum(["INSTANT","DAILY","WEEKLY"]).default("DAILY"),
});

type MapBounds={north:number;south:number;east:number;west:number};
function savedMapBounds(filters:unknown):MapBounds|null{
  if(!filters||typeof filters!=="object"||Array.isArray(filters))return null;
  const raw=(filters as Record<string,unknown>).mapBounds;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
  const b=raw as Record<string,unknown>,north=Number(b.north),south=Number(b.south),east=Number(b.east),west=Number(b.west);
  if(![north,south,east,west].every(Number.isFinite)||south>=north||west>=east||north>90||south< -90||east>180||west< -180)return null;
  return{north,south,east,west};
}
function savedAreaKey(filters:unknown){
  if(!filters||typeof filters!=="object"||Array.isArray(filters))return null;
  const value=(filters as Record<string,unknown>).areaKey;
  return typeof value==="string"&&value.length>=8&&value.length<=180?value:null;
}

export async function registerAccountEngagementRoutes(app: FastifyInstance) {
  app.get("/account/favorites", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT f."id",f."createdAt",l."id" AS "listingId",l."title",l."slug",l."priceMinor",l."currency",l."city",c."name" AS "categoryName",c."slug" AS "categorySlug",c."domain"::text AS "categoryDomain",pd."transactionType"::text AS "propertyTransactionType",
      (SELECT lm."publicUrl" FROM "ListingMedia" lm WHERE lm."listingId"=l."id" AND lm."status"='READY' ORDER BY lm."isCover" DESC,lm."sortOrder" ASC LIMIT 1) AS "imageUrl"
      FROM "FavoriteListing" f JOIN "Listing" l ON l."id"=f."listingId" JOIN "Category" c ON c."id"=l."categoryId" LEFT JOIN "PropertyDetails" pd ON pd."listingId"=l."id"
      WHERE f."userId"=$1 AND l."status"='PUBLISHED' ORDER BY f."createdAt" DESC`, user.id);
    return reply.send({ favorites: rows });
  });

  app.post("/account/favorites/:listingId", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = z.object({ listingId: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    const listing = await prisma.listing.findFirst({ where: { id: parsed.data.listingId, status: "PUBLISHED" }, select: { id: true, priceMinor: true } });
    if (!listing) return reply.code(404).send({ error: "listing_not_found" });
    await prisma.$executeRawUnsafe(`INSERT INTO "FavoriteListing" ("id","userId","listingId","lastPriceMinor") VALUES ($1,$2,$3,$4) ON CONFLICT ("userId","listingId") DO UPDATE SET "lastPriceMinor"=COALESCE("FavoriteListing"."lastPriceMinor",EXCLUDED."lastPriceMinor")`, randomUUID(), user.id, listing.id, listing.priceMinor);
    return reply.code(201).send({ favorite: true });
  });

  app.delete("/account/favorites/:listingId", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = z.object({ listingId: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_listing" });
    await prisma.$executeRawUnsafe(`DELETE FROM "FavoriteListing" WHERE "userId"=$1 AND "listingId"=$2`, user.id, parsed.data.listingId);
    return reply.code(204).send();
  });

  app.get("/account/saved-searches", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "SavedSearch" WHERE "userId"=$1 ORDER BY "createdAt" DESC`, user.id);
    return reply.send({ searches: rows });
  });

  app.post("/account/saved-searches", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = savedSearchSchema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ error: "invalid_search", details: parsed.error.flatten() });
    const d = parsed.data; const areaKey=savedAreaKey(d.filters);
    if(areaKey){
      const existing=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "SavedSearch" WHERE "userId"=$1 AND "filters"->>'areaKey'=$2 LIMIT 1`,user.id,areaKey);
      if(existing.length)return reply.code(409).send({error:"saved_search_exists",id:existing[0]!.id});
    }
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "SavedSearch" ("id","userId","name","query","categorySlug","city","postalCode","minPriceMinor","maxPriceMinor","filters","alertEnabled","frequency","lastRunAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,CURRENT_TIMESTAMP)`, id,user.id,d.name,d.query??null,d.categorySlug??null,d.city??null,d.postalCode??null,d.minPriceMinor??null,d.maxPriceMinor??null,JSON.stringify(d.filters??{}),d.alertEnabled,d.frequency);
    return reply.code(201).send({ id });
  });

  app.put("/account/saved-searches/:id", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params); const body = savedSearchSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" }); const d=body.data;
    const count = await prisma.$executeRawUnsafe(`UPDATE "SavedSearch" SET "name"=$1,"query"=$2,"categorySlug"=$3,"city"=$4,"postalCode"=$5,"minPriceMinor"=$6,"maxPriceMinor"=$7,"filters"=$8::jsonb,"alertEnabled"=$9,"frequency"=$10,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$11 AND "userId"=$12`,d.name,d.query??null,d.categorySlug??null,d.city??null,d.postalCode??null,d.minPriceMinor??null,d.maxPriceMinor??null,JSON.stringify(d.filters??{}),d.alertEnabled,d.frequency,params.data.id,user.id);
    if (!count) return reply.code(404).send({ error: "saved_search_not_found" }); return reply.send({ updated: true });
  });

  app.delete("/account/saved-searches/:id", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    await prisma.$executeRawUnsafe(`DELETE FROM "SavedSearch" WHERE "id"=$1 AND "userId"=$2`, parsed.data.id,user.id); return reply.code(204).send();
  });

  app.post("/internal/engagement-alerts/sweep", async (request, reply) => {
    const secret = String(request.headers["x-internal-secret"] ?? "");
    if (!process.env.INTERNAL_CRON_SECRET || secret !== process.env.INTERNAL_CRON_SECRET) return reply.code(401).send({ error: "unauthorized" });
    const favoriteRows = await prisma.$queryRawUnsafe<Array<{favoriteId:string;userId:string;listingId:string;title:string|null;slug:string|null;currency:string;priceMinor:number|null;lastPriceMinor:number|null;lastPriceNotifiedMinor:number|null}>>(`
      SELECT f."id" AS "favoriteId",f."userId",f."listingId",f."lastPriceMinor",f."lastPriceNotifiedMinor",l."title",l."slug",l."currency",l."priceMinor"
      FROM "FavoriteListing" f JOIN "Listing" l ON l."id"=f."listingId" WHERE l."status"='PUBLISHED' LIMIT 500`);
    let priceAlerts = 0;
    for (const row of favoriteRows) {
      if (row.priceMinor != null && row.lastPriceMinor != null && row.priceMinor < row.lastPriceMinor && row.lastPriceNotifiedMinor !== row.priceMinor) {
        const oldPrice = new Intl.NumberFormat("fr-FR",{style:"currency",currency:row.currency}).format(row.lastPriceMinor/100);
        const newPrice = new Intl.NumberFormat("fr-FR",{style:"currency",currency:row.currency}).format(row.priceMinor/100);
        await deliverUserEvent({userId:row.userId,eventKind:"LISTING",notificationKind:"LISTING",title:"Baisse de prix sur un favori",body:`${row.title ?? "Une annonce favorite"} passe de ${oldPrice} à ${newPrice}.`,actionUrl:row.slug?`/annonce/${row.slug}`:"/mon-compte/favoris",metadata:{listingId:row.listingId,oldPriceMinor:row.lastPriceMinor,newPriceMinor:row.priceMinor,source:"FAVORITE_PRICE_DROP"}});
        priceAlerts++;
        await prisma.$executeRawUnsafe(`UPDATE "FavoriteListing" SET "lastPriceMinor"=$1,"lastPriceNotifiedMinor"=$1 WHERE "id"=$2`,row.priceMinor,row.favoriteId);
      } else if (row.priceMinor !== row.lastPriceMinor) {
        await prisma.$executeRawUnsafe(`UPDATE "FavoriteListing" SET "lastPriceMinor"=$1 WHERE "id"=$2`,row.priceMinor,row.favoriteId);
      }
    }
    const searches = await prisma.$queryRawUnsafe<Array<{id:string;userId:string;name:string;query:string|null;categorySlug:string|null;city:string|null;postalCode:string|null;minPriceMinor:number|null;maxPriceMinor:number|null;filters:unknown;frequency:string;lastRunAt:Date|null}>>(`
      SELECT "id","userId","name","query","categorySlug","city","postalCode","minPriceMinor","maxPriceMinor","filters","frequency","lastRunAt" FROM "SavedSearch"
      WHERE "alertEnabled"=TRUE AND ("lastRunAt" IS NULL OR ("frequency"='INSTANT' AND "lastRunAt"<=CURRENT_TIMESTAMP-INTERVAL '1 hour') OR ("frequency"='DAILY' AND "lastRunAt"<=CURRENT_TIMESTAMP-INTERVAL '1 day') OR ("frequency"='WEEKLY' AND "lastRunAt"<=CURRENT_TIMESTAMP-INTERVAL '7 days')) LIMIT 200`);
    let searchAlerts = 0;
    for (const s of searches) {
      const since = s.lastRunAt ?? new Date();
      const bounds=savedMapBounds(s.filters);
      const matches = await prisma.$queryRawUnsafe<Array<{id:string;title:string|null;slug:string|null}>>(`
        SELECT l."id",l."title",l."slug" FROM "Listing" l JOIN "Category" c ON c."id"=l."categoryId"
        WHERE l."status"='PUBLISHED' AND l."publishedAt">$1
          AND l."sellerId"<>$12
          AND ($2::text IS NULL OR l."title" ILIKE '%'||$2||'%' OR l."description" ILIKE '%'||$2||'%')
          AND ($3::text IS NULL OR c."slug"=$3) AND ($4::text IS NULL OR l."city" ILIKE $4)
          AND ($5::text IS NULL OR l."postalCode"=$5) AND ($6::int IS NULL OR l."priceMinor">=$6) AND ($7::int IS NULL OR l."priceMinor"<=$7)
          AND ($8::double precision IS NULL OR (l."latitude" IS NOT NULL AND l."longitude" IS NOT NULL AND l."latitude"<=$8 AND l."latitude">=$9 AND l."longitude"<=$10 AND l."longitude">=$11))
        ORDER BY l."publishedAt" DESC LIMIT 5`,since,s.query||null,s.categorySlug||null,s.city||null,s.postalCode||null,s.minPriceMinor,s.maxPriceMinor,bounds?.north??null,bounds?.south??null,bounds?.east??null,bounds?.west??null,s.userId);
      if (matches.length) {
        if(s.frequency==="INSTANT"){
          for(const match of matches){
            await deliverUserEvent({userId:s.userId,eventKind:"LISTING",notificationKind:"SEARCH",title:`Nouvelle annonce pour « ${s.name} »`,body:match.title??"Une nouvelle annonce correspond à votre recherche.",actionUrl:match.slug?`/annonce/${encodeURIComponent(match.slug)}`:"/mon-compte/recherches",metadata:{savedSearchId:s.id,listingId:match.id,listingIds:[match.id],matchCount:1,source:"SAVED_SEARCH_INSTANT"},dedupeKey:`saved-search:${s.id}:listing:${match.id}`});
            searchAlerts++;
          }
          await prisma.$executeRawUnsafe(`UPDATE "SavedSearch" SET "lastRunAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,s.id);
          continue;
        }
        const first=matches[0]!; const count=matches.length;
        const target=new URLSearchParams();
        if(s.query)target.set("q",s.query);
        if(s.categorySlug)target.set("category",s.categorySlug);
        if(s.city)target.set("city",s.city);
        if(s.minPriceMinor!=null)target.set("minPrice",String(Math.round(s.minPriceMinor/100)));
        if(s.maxPriceMinor!=null)target.set("maxPrice",String(Math.round(s.maxPriceMinor/100)));
        if(bounds){target.set("view","map");target.set("north",bounds.north.toFixed(5));target.set("south",bounds.south.toFixed(5));target.set("east",bounds.east.toFixed(5));target.set("west",bounds.west.toFixed(5));}
        target.set("savedSearchId",s.id);
        await deliverUserEvent({userId:s.userId,eventKind:"LISTING",notificationKind:"SEARCH",title:count===1?"Nouvelle annonce correspondant à votre recherche":`${count} nouvelles annonces correspondent à votre recherche`,body:`Recherche « ${s.name} » : ${first.title ?? "nouvelle annonce"}${count>1?` et ${count-1} autre(s).`:""}`,actionUrl:`/recherche?${target.toString()}`,metadata:{savedSearchId:s.id,matchCount:count,listingIds:matches.map(x=>x.id),source:"SAVED_SEARCH"}});
        searchAlerts++;
      }
      await prisma.$executeRawUnsafe(`UPDATE "SavedSearch" SET "lastRunAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,s.id);
    }
    return reply.send({processedFavorites:favoriteRows.length,priceAlerts,processedSearches:searches.length,searchAlerts});
  });

  app.get("/account/notifications", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const query=z.object({includeRead:z.coerce.boolean().default(false),limit:z.coerce.number().int().min(1).max(200).default(100)}).safeParse(request.query??{});
    if(!query.success)return reply.code(400).send({error:"invalid_request"});
    await prisma.$executeRawUnsafe(`DELETE FROM "UserNotification" WHERE "userId"=$1 AND "readAt" IS NOT NULL AND "readAt"<CURRENT_TIMESTAMP-INTERVAL '90 days'`,user.id);
    const rows = query.data.includeRead
      ? await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","kind","title","body","actionUrl","metadata","readAt","createdAt" FROM "UserNotification" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT $2`,user.id,query.data.limit)
      : await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT "id","kind","title","body","actionUrl","metadata","readAt","createdAt" FROM "UserNotification" WHERE "userId"=$1 AND "readAt" IS NULL ORDER BY "createdAt" DESC LIMIT $2`,user.id,query.data.limit);
    const unreadRows=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "UserNotification" WHERE "userId"=$1 AND "readAt" IS NULL`,user.id);
    return reply.send({ notifications: rows, unread:Number(unreadRows[0]?.count??0n) });
  });

  app.post("/account/notifications/:id/read", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const parsed=z.object({id:z.string().min(1)}).safeParse(request.params); if(!parsed.success)return reply.code(400).send({error:"invalid_request"});
    const changed=await prisma.$executeRawUnsafe(`UPDATE "UserNotification" SET "readAt"=COALESCE("readAt",CURRENT_TIMESTAMP) WHERE "id"=$1 AND "userId"=$2`,parsed.data.id,user.id);
    if(!changed)return reply.code(404).send({error:"notification_not_found"});
    const unreadRows=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS "count" FROM "UserNotification" WHERE "userId"=$1 AND "readAt" IS NULL`,user.id);
    return reply.send({read:true,deleted:false,unread:Number(unreadRows[0]?.count??0n)});
  });

  app.post("/account/notifications/read-all", async (request, reply) => {
    const user=await requireListingUser(request,reply); if(!user)return;
    const parsed=z.object({confirm:z.literal("ALL")}).safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"explicit_confirmation_required"});
    await prisma.$executeRawUnsafe(`UPDATE "UserNotification" SET "readAt"=COALESCE("readAt",CURRENT_TIMESTAMP) WHERE "userId"=$1 AND "readAt" IS NULL`,user.id);
    return reply.send({read:true,deleted:false,unread:0});
  });
}
