import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchOpenSearch } from "./opensearch.js";
import { calculateTrustScore } from "./trust-score.js";
import { buildReputation } from "./reputation.js";
import { getRuntimeIntegration } from "./admin-control.js";
import { geocodeFrenchSearchLocation, reverseFrenchLocation } from "./geocoding.js";

const searchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(100).optional(),
  city: z.string().trim().max(120).optional(),
  make: z.string().trim().max(80).optional(),
  model: z.string().trim().max(100).optional(),
  transactionType: z.enum(["SALE","RENTAL"]).optional(),
  propertyType: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  near: z.string().trim().min(24).max(700).optional(),
  radiusKm: z.coerce.number().min(1).max(300).optional(),
  north: z.coerce.number().min(-90).max(90).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
  map: z.literal("1").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  sort: z.enum(["recent","price_asc","price_desc"]).default("recent"),
});

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GEO_TOKEN_TTL_MS=15*60*1000;
function geoTokenKey(){const raw=process.env.SEARCH_GEO_TOKEN_KEY?.trim();return raw?createHash("sha256").update(raw).digest():null}
function createGeoToken(latitude:number,longitude:number){const key=geoTokenKey();if(!key)return null;const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key,iv);const payload=JSON.stringify({v:1,lat:Number(latitude.toFixed(6)),lng:Number(longitude.toFixed(6)),exp:Date.now()+GEO_TOKEN_TTL_MS});const body=Buffer.concat([cipher.update(payload,"utf8"),cipher.final()]);const tag=cipher.getAuthTag();return Buffer.concat([iv,tag,body]).toString("base64url")}
function readGeoToken(value:string|undefined){if(!value)return null;const key=geoTokenKey();if(!key)return null;try{const raw=Buffer.from(value,"base64url");if(raw.length<29)return null;const iv=raw.subarray(0,12),tag=raw.subarray(12,28),body=raw.subarray(28);const decipher=createDecipheriv("aes-256-gcm",key,iv);decipher.setAuthTag(tag);const parsed=JSON.parse(Buffer.concat([decipher.update(body),decipher.final()]).toString("utf8")) as {v?:number;lat?:number;lng?:number;exp?:number};if(parsed.v!==1||!Number.isFinite(parsed.lat)||!Number.isFinite(parsed.lng)||!Number.isFinite(parsed.exp)||parsed.exp!<=Date.now())return null;if(parsed.lat!<-90||parsed.lat!>90||parsed.lng!<-180||parsed.lng!>180)return null;return{latitude:parsed.lat!,longitude:parsed.lng!}}catch{return null}}

type SearchItemBase = { id: string; sellerId: string };
type ReputationRow = { id:string; kind:string; createdAt:Date; emailVerified:boolean; phoneVerified:boolean; avatarUrl:string|null; sellerName:string|null; verified:boolean; hasStore:boolean; paymentReady:boolean; reviewCount:bigint; reviewAverage:number|null; completedSales:bigint; canceledSales:bigint; disputedSales:bigint; responseSamples:bigint; responseWithin2h:bigint; averageResponseMinutes:number|null; shipmentSamples:bigint; shipmentWithin48h:bigint };
type CommerceRow = { listingId:string; securePaymentEnabled:boolean; mondialRelayEnabled:boolean; colissimoEnabled:boolean };
type MediaRow = { listingId:string; publicUrl:string };
type PromotionRow = { listingId:string; code:string; type:string; name:string; endsAt:Date|null };
type PromotionRankRow = { listingId:string; priority:number; boostedAt:Date|null };

async function activePromotionRanks(listingIds?:string[]){
  const sql=`SELECT lp."listingId",MAX(CASE pp."type" WHEN 'BUMP' THEN 50 WHEN 'SPONSORED' THEN 40 WHEN 'FEATURED' THEN 30 ELSE 0 END)::int AS priority,MAX(COALESCE(lp."startsAt",lp."createdAt")) AS "boostedAt" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."status"='ACTIVE' AND (lp."startsAt" IS NULL OR lp."startsAt"<=CURRENT_TIMESTAMP) AND (lp."endsAt" IS NULL OR lp."endsAt">CURRENT_TIMESTAMP) ${listingIds?.length?'AND lp."listingId"=ANY($1::text[])':''} GROUP BY lp."listingId" HAVING MAX(CASE pp."type" WHEN 'BUMP' THEN 50 WHEN 'SPONSORED' THEN 40 WHEN 'FEATURED' THEN 30 ELSE 0 END)>0 ORDER BY priority DESC,"boostedAt" DESC`;
  return listingIds?.length?prisma.$queryRawUnsafe<PromotionRankRow[]>(sql,listingIds):prisma.$queryRawUnsafe<PromotionRankRow[]>(sql);
}

const BOOST_SLOT_INDEXES=[2,5] as const;
function availableBoostSlots(limit:number){return BOOST_SLOT_INDEXES.filter(index=>index<limit).length}
function insertBoostedAtLegacySlots<T>(normalItems:T[],boostedItems:T[],limit:number){
  const result=normalItems.slice(0,Math.max(0,limit-boostedItems.length));
  for(let i=0;i<boostedItems.length;i++){
    const item=boostedItems[i];if(item===undefined)continue;
    const target=BOOST_SLOT_INDEXES[i]??Math.min(result.length,5+i);
    result.splice(Math.min(target,result.length),0,item);
  }
  return result.slice(0,limit);
}

export async function enrichItems<T extends SearchItemBase>(items:T[]){
  if(!items.length)return items;
  const sellerIds=[...new Set(items.map((item)=>item.sellerId))];
  const listingIds=items.map((item)=>item.id);
  const [reputationRows,mediaRows,commerceRows,promotionRows]=await Promise.all([
    prisma.$queryRawUnsafe<ReputationRow[]>(`
      SELECT u."id",u."kind"::text AS "kind",u."createdAt",(u."emailVerifiedAt" IS NOT NULL) AS "emailVerified",(p."phoneVerifiedAt" IS NOT NULL) AS "phoneVerified",p."avatarUrl",
        COALESCE(NULLIF(b."tradeName",''),NULLIF(p."displayName",''),NULLIF(p."firstName",''),split_part(u."email",'@',1)) AS "sellerName",
        EXISTS(SELECT 1 FROM "Store" ps WHERE ps."ownerId"=u."id" AND ps."status"='ACTIVE') AS "hasStore",
        EXISTS(SELECT 1 FROM "MarketplaceSellerAccount" msa WHERE msa."userId"=u."id" AND msa."onboardingStatus"='ACTIVE' AND msa."payoutsEnabled"=TRUE AND msa."detailsSubmitted"=TRUE) AS "paymentReady",
        (COALESCE(b."verificationStatus"='VERIFIED',FALSE) OR EXISTS(SELECT 1 FROM "Store" s WHERE s."ownerId"=u."id" AND s."status"='ACTIVE' AND s."isVerified"=TRUE)) AS "verified",
        COALESCE(r."reviewCount",0)::bigint AS "reviewCount",r."reviewAverage",
        COALESCE(o."completedSales",0)::bigint AS "completedSales",COALESCE(o."canceledSales",0)::bigint AS "canceledSales",COALESCE(o."disputedSales",0)::bigint AS "disputedSales",
        COALESCE(resp.samples,0)::bigint AS "responseSamples",COALESCE(resp.within2h,0)::bigint AS "responseWithin2h",resp."averageResponseMinutes",
        COALESCE(ship.samples,0)::bigint AS "shipmentSamples",COALESCE(ship.within48h,0)::bigint AS "shipmentWithin48h"
      FROM "User" u
      LEFT JOIN "UserProfile" p ON p."userId"=u."id"
      LEFT JOIN "BusinessProfile" b ON b."userId"=u."id"
      LEFT JOIN LATERAL (SELECT COUNT(*)::bigint AS "reviewCount",AVG("rating")::float AS "reviewAverage" FROM "MarketplaceReview" mr JOIN "MarketplaceOrder" ro ON ro."id"=mr."orderId" AND ro."status"='COMPLETED' WHERE mr."revieweeId"=u."id" AND mr."direction"='BUYER_TO_SELLER') r ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER(WHERE mo."status"='COMPLETED')::bigint AS "completedSales",
          COUNT(*) FILTER(
            WHERE mo."status"='CANCELED'
              AND (
                mo."paidAt" IS NOT NULL
                OR EXISTS (
                  SELECT 1 FROM "MarketplacePayment" mp
                  WHERE mp."orderId"=mo."id"
                    AND mp."status" IN ('AUTHORIZED','CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
                )
              )
          )::bigint AS "canceledSales",
          COUNT(*) FILTER(WHERE mo."status"='DISPUTED')::bigint AS "disputedSales"
        FROM "MarketplaceOrder" mo WHERE mo."sellerId"=u."id"
      ) o ON TRUE
      LEFT JOIN LATERAL (WITH samples AS (SELECT EXTRACT(EPOCH FROM (sm.first_seller-bm.first_buyer))/60.0 AS minutes FROM "Conversation" c JOIN LATERAL (SELECT MIN(m."createdAt") AS first_buyer FROM "Message" m WHERE m."conversationId"=c."id" AND m."senderId"=c."buyerId" AND m."createdAt">=CURRENT_TIMESTAMP-INTERVAL '90 days') bm ON bm.first_buyer IS NOT NULL JOIN LATERAL (SELECT MIN(m."createdAt") AS first_seller FROM "Message" m WHERE m."conversationId"=c."id" AND m."senderId"=c."sellerId" AND m."createdAt">bm.first_buyer) sm ON sm.first_seller IS NOT NULL WHERE c."sellerId"=u."id") SELECT COUNT(*)::bigint AS samples,COUNT(*) FILTER(WHERE minutes<=120)::bigint AS within2h,AVG(minutes)::float AS "averageResponseMinutes" FROM samples) resp ON TRUE
      LEFT JOIN LATERAL (SELECT COUNT(*)::bigint AS samples,COUNT(*) FILTER(WHERE ms."shippedAt"<=mo2."paidAt"+INTERVAL '48 hours')::bigint AS within48h FROM "MarketplaceShipment" ms JOIN "MarketplaceOrder" mo2 ON mo2."id"=ms."orderId" WHERE mo2."sellerId"=u."id" AND mo2."paidAt" IS NOT NULL AND ms."shippedAt" IS NOT NULL) ship ON TRUE
      WHERE u."id" = ANY($1::text[])`,sellerIds),
    prisma.$queryRawUnsafe<MediaRow[]>(`SELECT DISTINCT ON (lm."listingId") lm."listingId",lm."publicUrl" FROM "ListingMedia" lm WHERE lm."listingId" = ANY($1::text[]) AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL ORDER BY lm."listingId",lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC`,listingIds),
    prisma.$queryRawUnsafe<CommerceRow[]>(`SELECT "listingId","securePaymentEnabled","mondialRelayEnabled","colissimoEnabled" FROM "ListingCommerceSettings" WHERE "listingId" = ANY($1::text[])`,listingIds),
    prisma.$queryRawUnsafe<PromotionRow[]>(`SELECT lp."listingId",pp."code",pp."type"::text AS "type",pp."name",lp."endsAt" FROM "ListingPromotion" lp JOIN "PromotionProduct" pp ON pp."id"=lp."productId" WHERE lp."listingId" = ANY($1::text[]) AND lp."status"='ACTIVE' AND (lp."startsAt" IS NULL OR lp."startsAt"<=CURRENT_TIMESTAMP) AND (lp."endsAt" IS NULL OR lp."endsAt">CURRENT_TIMESTAMP) ORDER BY lp."createdAt" DESC`,listingIds)
  ]);
  const reps=new Map(reputationRows.map((row)=>{
    const reviewCount=Number(row.reviewCount),completedSales=Number(row.completedSales),responseSamples=Number(row.responseSamples),shipmentSamples=Number(row.shipmentSamples);
    const reputation=buildReputation({verified:row.verified,emailVerified:row.emailVerified,phoneVerified:row.phoneVerified,kind:row.kind,memberSince:row.createdAt,reviewCount,reviewAverage:row.reviewAverage,completedSales,canceledSales:Number(row.canceledSales),disputedSales:Number(row.disputedSales),responseSamples,responseWithinTwoHoursRate:responseSamples?Number(row.responseWithin2h)/responseSamples:0,averageResponseMinutes:row.averageResponseMinutes,shipmentSamples,shipmentWithin48HoursRate:shipmentSamples?Number(row.shipmentWithin48h)/shipmentSamples:0});
    return [row.id,{verified:row.verified,emailVerified:row.emailVerified,kind:row.kind,hasStore:row.hasStore,paymentReady:row.paymentReady,avatarUrl:row.avatarUrl,sellerName:row.sellerName??"Membre",reviewCount,reviewAverage:row.reviewAverage,completedSales,trust:reputation.trust,badges:reputation.badges,cardBadges:reputation.cardBadges}] as const;
  }));
  const media=new Map(mediaRows.map((row)=>[row.listingId,row.publicUrl] as const));
  const commerce=new Map(commerceRows.map((row)=>[row.listingId,{securePaymentEnabled:row.securePaymentEnabled,shippingEnabled:row.mondialRelayEnabled||row.colissimoEnabled}] as const));
  const promotions=new Map<string,PromotionRow[]>();
  for(const row of promotionRows){const current=promotions.get(row.listingId)??[];current.push(row);promotions.set(row.listingId,current)}
  return items.map((item)=>({...item,imageUrl:media.get(item.id)??null,commerce:commerce.get(item.id)??{securePaymentEnabled:false,shippingEnabled:false},promotions:(promotions.get(item.id)??[]).map(row=>({code:row.code,type:row.type,name:row.name,endsAt:row.endsAt?.toISOString()??null})),sellerReputation:reps.get(item.sellerId)??{verified:false,kind:"PARTICULIER",hasStore:false,paymentReady:false,reviewCount:0,reviewAverage:null,completedSales:0,trust:{score:0,reliableSeller:false,level:"NEW" as const}}}));
}

function normalizeCityKey(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function citySlug(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}

export async function registerSearchRoutes(app: FastifyInstance) {
  app.post("/search/around-me", async (request, reply) => {
    const parsed = z.object({ latitude:z.number().min(-90).max(90), longitude:z.number().min(-180).max(180) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error:"invalid_location" });
    const location = await reverseFrenchLocation(parsed.data.latitude, parsed.data.longitude);
    if (!location) return reply.code(404).send({ error:"location_not_resolved" });
    const nearToken=createGeoToken(parsed.data.latitude,parsed.data.longitude);
    if(!nearToken)return reply.code(503).send({error:"around_me_not_configured"});
    return reply.send({ city:location.city, postalCode:location.postalCode, region:location.region, radiusKm:25, nearToken, expiresInSeconds:GEO_TOKEN_TTL_MS/1000 });
  });

  app.post("/search/ai", async (request, reply) => {
    const parsed = z.object({ query: z.string().trim().min(2).max(180) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_ai_search" });
    const query = parsed.data.query;
    const openai = await getRuntimeIntegration("openai");
    const apiKey = (openai?.enabled ? openai.secrets.apiKey : process.env.OPENAI_API_KEY)?.trim();
    const model = String(openai?.enabled ? (openai.config.searchModel ?? openai.config.model ?? "") : (process.env.AI_SEARCH_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "")).trim();
    const fallback = () => reply.send({ mode: "fallback", params: { q: query } });
    if (!apiKey || !model) return fallback();

    try {
      const categories = await prisma.category.findMany({ where: { parentId: null }, select: { name: true, slug: true }, orderBy: { name: "asc" } });
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          input: `Tu transformes une recherche en langage naturel pour une marketplace française en filtres de recherche. Réponds uniquement par un objet JSON compact avec les clés optionnelles q, city, category, minPrice, maxPrice. Ne crée pas de clé supplémentaire. Catégories autorisées: ${categories.map(c => `${c.name}:${c.slug}`).join(", ")}. Requête: ${query}`,
          max_output_tokens: 180,
        }),
        signal: AbortSignal.timeout(6500),
      });
      if (!response.ok) return fallback();
      const payload = await response.json() as any;
      const direct = typeof payload.output_text === "string" ? payload.output_text : null;
      const nested = Array.isArray(payload.output) ? payload.output.flatMap((item:any)=>Array.isArray(item?.content)?item.content:[]).find((part:any)=>part?.type==="output_text")?.text : null;
      const raw = String(direct ?? nested ?? "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      const data = JSON.parse(raw) as Record<string, unknown>;
      const categorySlugs = new Set(categories.map(c=>c.slug));
      const params:Record<string,string|number> = {};
      if (typeof data.q === "string" && data.q.trim()) params.q = data.q.trim().slice(0,120);
      if (typeof data.city === "string" && data.city.trim()) params.city = data.city.trim().slice(0,120);
      if (typeof data.category === "string" && categorySlugs.has(data.category)) params.category = data.category;
      if (typeof data.minPrice === "number" && Number.isFinite(data.minPrice) && data.minPrice >= 0) params.minPrice = Math.round(data.minPrice);
      if (typeof data.maxPrice === "number" && Number.isFinite(data.maxPrice) && data.maxPrice >= 0) params.maxPrice = Math.round(data.maxPrice);
      if (!Object.keys(params).length) params.q = query;
      return reply.send({ mode: "ai", params });
    } catch {
      return fallback();
    }
  });
  app.get("/search", async (request, reply) => {
    const parsed = searchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_search", details: parsed.error.flatten() });
    const p = parsed.data;
    const boundValues=[p.north,p.south,p.east,p.west];
    const anyBounds=boundValues.some(value=>value!==undefined);
    const hasBounds=boundValues.every(value=>value!==undefined);
    if(anyBounds&&(!hasBounds||p.south!>=p.north!||p.west!>=p.east!))return reply.code(400).send({error:"invalid_map_bounds"});
    const rawQuery=(request.query??{}) as Record<string,unknown>;
    type RequestedAttributeFilter={key:string;exact?:string;min?:number;max?:number};
    const attributeFilterMap=new Map<string,RequestedAttributeFilter>();
    for(const [rawKey,rawValue] of Object.entries(rawQuery)){
      if(!rawKey.startsWith("attr_")||typeof rawValue!=="string"||!rawValue.trim())continue;
      const match=rawKey.match(/^attr_(.+?)(?:_(min|max))?$/);if(!match)continue;
      const key=String(match[1]??"").slice(0,80);if(!key)continue;
      const filter=attributeFilterMap.get(key)??{key};const suffix=match[2];const value=rawValue.trim().slice(0,200);
      if(suffix){const numeric=Number(value.replace(",","."));if(Number.isFinite(numeric)){if(suffix==="min")filter.min=numeric;else if(suffix==="max")filter.max=numeric}}
      else filter.exact=value;
      attributeFilterMap.set(key,filter);
      if(attributeFilterMap.size>=20)break;
    }
    const requestedAttributeFilters=[...attributeFilterMap.values()];
    const minPriceMinor = p.minPrice !== undefined ? Math.round(p.minPrice * 100) : undefined;
    const maxPriceMinor = p.maxPrice !== undefined ? Math.round(p.maxPrice * 100) : undefined;

    let categoryIds: string[] | undefined;
    let categoryDomain:string|undefined;
    if (p.category) {
      const rootCategory=await prisma.category.findUnique({where:{slug:p.category},select:{domain:true}});
      categoryDomain=rootCategory?.domain;
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `WITH RECURSIVE category_tree AS (
           SELECT "id" FROM "Category" WHERE "slug"=$1
           UNION ALL
           SELECT c."id" FROM "Category" c JOIN category_tree parent ON c."parentId"=parent."id"
         ) SELECT "id" FROM category_tree`,
        p.category,
      );
      if (rows.length) categoryIds = rows.map((row) => row.id);
    }
    const vehicleFieldMap:Record<string,string>={brand:"make",model:"model",mileage:"mileageKm",fuel:"fuel",gearbox:"transmission",fiscalPower:"fiscalPowerCv",powerKw:"powerKw",seats:"seats",doors:"doors",color:"color",bodyStyle:"bodyType"};
    const numericVehicleFields=new Set(["mileageKm","fiscalPowerCv","powerKw","seats","doors"]);
    const vehicleWhere:any={};
    let attributeAnd:any[]=[];
    if(requestedAttributeFilters.length&&categoryIds?.length){
      const keys=[...new Set(requestedAttributeFilters.map(x=>x.key))];
      const defs=await prisma.categoryAttribute.findMany({where:{categoryId:{in:categoryIds},key:{in:keys}},select:{key:true,type:true}});
      const typeByKey=new Map(defs.map(d=>[d.key,d.type] as const));
      for(const filter of requestedAttributeFilters){
        const type=typeByKey.get(filter.key);if(!type)continue;
        const vehicleField=categoryDomain==="VEHICLE"?vehicleFieldMap[filter.key]:undefined;
        if(vehicleField){
          if(numericVehicleFields.has(vehicleField)){
            const numericRange:any={};if(filter.min!==undefined)numericRange.gte=filter.min;if(filter.max!==undefined)numericRange.lte=filter.max;
            if(filter.exact!==undefined){if(filter.key==="doors"&&filter.exact.endsWith("+")){const n=Number(filter.exact.replace("+",""));if(Number.isFinite(n))numericRange.gte=n}else{const n=Number(filter.exact.replace(",","."));if(Number.isFinite(n)){numericRange.gte=n;numericRange.lte=n}}}
            if(Object.keys(numericRange).length)vehicleWhere[vehicleField]=numericRange;
          }else if(filter.exact){vehicleWhere[vehicleField]={equals:filter.exact,mode:"insensitive"}}
          continue;
        }
        if(type==="NUMBER"){
          const range:any={};if(filter.min!==undefined)range.gte=filter.min;if(filter.max!==undefined)range.lte=filter.max;
          if(filter.exact!==undefined){const n=Number(filter.exact.replace(",","."));if(Number.isFinite(n)){range.gte=n;range.lte=n}}
          if(Object.keys(range).length)attributeAnd.push({attributes:{some:{attribute:{key:filter.key},valueNumber:range}}});continue;
        }
        if(!filter.exact)continue;
        if(type==="BOOLEAN"){const b=filter.exact==="true"?true:filter.exact==="false"?false:null;if(b!==null)attributeAnd.push({attributes:{some:{attribute:{key:filter.key},valueBoolean:b}}});continue}
        if(type==="MULTISELECT"){attributeAnd.push({attributes:{some:{attribute:{key:filter.key},valueJson:{array_contains:[filter.exact]}}}});continue}
        if(type==="TEXT"){attributeAnd.push({attributes:{some:{attribute:{key:filter.key},valueText:{contains:filter.exact,mode:"insensitive"}}}});continue}
        attributeAnd.push({attributes:{some:{attribute:{key:filter.key},valueText:{equals:filter.exact,mode:"insensitive"}}}});
      }
    }
    if(p.make)vehicleWhere.make={equals:p.make,mode:"insensitive"};
    if(p.model)vehicleWhere.model={equals:p.model,mode:"insensitive"};

    const nearGeo=readGeoToken(p.near);
    let geoLat=nearGeo?.latitude??p.lat,geoLng=nearGeo?.longitude??p.lng;
    if(p.radiusKm!==undefined&&(geoLat===undefined||geoLng===undefined)&&p.city){const geo=await geocodeFrenchSearchLocation(p.city);if(geo){geoLat=geo.latitude;geoLng=geo.longitude}}
    const needsGeo=geoLat!==undefined&&geoLng!==undefined&&p.radiusKm!==undefined;
    const useOpenSearch = Boolean(p.q) && !p.category && !needsGeo && !hasBounds && p.map!=="1" && requestedAttributeFilters.length===0 && !p.make && !p.model && !p.transactionType && !p.propertyType;
    const os = useOpenSearch ? await searchOpenSearch({ q: p.q, category: p.category, city: p.city, minPriceMinor, maxPriceMinor, page: p.page, limit: p.limit }).catch(() => null) : null;
    if (os?.ids.length) {
      const records = await prisma.listing.findMany({ where: { id: { in: os.ids }, status: "PUBLISHED" }, include: { category: true, vehicle: true, property: true, energy: true } });
      const byId = new Map(records.map((record) => [record.id, record]));
      let ordered=os.ids.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item>=>Boolean(item));
      if(p.sort==="recent"&&ordered.length){
        const slotCount=availableBoostSlots(p.limit);
        if(slotCount){
          const ranks=await activePromotionRanks(ordered.map(item=>item.id));const rankMap=new Map(ranks.map(r=>[r.listingId,r] as const));const original=new Map(ordered.map((item,index)=>[item.id,index] as const));
          const boosted=ordered.filter(item=>rankMap.has(item.id)).sort((a,b)=>{const ar=rankMap.get(a.id),br=rankMap.get(b.id);const priority=(br?.priority??0)-(ar?.priority??0);if(priority)return priority;const boost=(br?.boostedAt?.getTime()??0)-(ar?.boostedAt?.getTime()??0);return boost||Number(original.get(a.id)??0)-Number(original.get(b.id)??0)}).slice(0,slotCount);
          const boostedIds=new Set(boosted.map(item=>item.id));ordered=insertBoostedAtLegacySlots(ordered.filter(item=>!boostedIds.has(item.id)),boosted,p.limit);
        }
      }
      return reply.send({ engine: "opensearch", page: p.page, limit: p.limit, total: os.total, items: await enrichItems(ordered) });
    }

    const locationFilter=p.city&&!needsGeo&&!hasBounds?(/^\d{5}$/.test(p.city)?{postalCode:{equals:p.city}}:{city:{equals:p.city,mode:"insensitive" as const}}):{};
    const mapCoordinateFilter=hasBounds?{latitude:{gte:p.south!,lte:p.north!},longitude:{gte:p.west!,lte:p.east!}}:p.map==="1"?{latitude:{not:null},longitude:{not:null}}:{};
    const where = {
      status: "PUBLISHED" as const,
      ...(categoryIds ? { categoryId: { in: categoryIds } } : p.category ? { category: { slug: p.category } } : {}),
      ...locationFilter,
      ...(Object.keys(vehicleWhere).length ? { vehicle: { is: vehicleWhere } } : {}),
      ...(p.transactionType || p.propertyType ? { property: { is: { ...(p.transactionType ? { transactionType: p.transactionType } : {}), ...(p.propertyType ? { propertyType: { equals: p.propertyType, mode: "insensitive" as const } } : {}) } } } : {}),
      ...(p.q ? { OR: [
        { title: { contains: p.q, mode: "insensitive" as const } },
        { description: { contains: p.q, mode: "insensitive" as const } },
        { category: { name: { contains: p.q, mode: "insensitive" as const } } },
      ] } : {}),
      ...(minPriceMinor !== undefined || maxPriceMinor !== undefined ? { priceMinor: { ...(minPriceMinor !== undefined ? { gte: minPriceMinor } : {}), ...(maxPriceMinor !== undefined ? { lte: maxPriceMinor } : {}) } } : {}),
      ...(attributeAnd.length?{AND:attributeAnd}:{}),
      ...mapCoordinateFilter,
    };

    if (needsGeo) {
      const candidates = await prisma.listing.findMany({
        where: { ...where, latitude: { not: null }, longitude: { not: null } },
        include: { category: true, vehicle: true, property: true, energy: true },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 500,
      });
      const filtered = candidates.map((item) => ({ ...item, distanceKm: haversineKm(geoLat!, geoLng!, item.latitude!, item.longitude!) })).filter((item) => item.distanceKm <= p.radiusKm!).sort((a, b) => a.distanceKm - b.distanceKm);
      const start = (p.page - 1) * p.limit;
      return reply.send({ engine: "postgres", page: p.page, limit: p.limit, total: filtered.length, items: await enrichItems(filtered.slice(start, start + p.limit)) });
    }

    const recentOrder=[{ publishedAt: "desc" as const }, { createdAt: "desc" as const }];
    if(p.sort==="recent"){
      const total=await prisma.listing.count({where});
      const slotCount=availableBoostSlots(p.limit);
      if(!slotCount){
        const items=await prisma.listing.findMany({where,include:{category:true,vehicle:true,property:true,energy:true},orderBy:recentOrder,skip:(p.page-1)*p.limit,take:p.limit});
        return reply.send({engine:"postgres",page:p.page,limit:p.limit,total,items:await enrichItems(items)});
      }
      const ranks=await activePromotionRanks();
      const rankedIds=ranks.map(r=>r.listingId);
      const matchingPromoted=rankedIds.length?await prisma.listing.findMany({where:{...where,id:{in:rankedIds}},select:{id:true}}):[];
      const matchingSet=new Set(matchingPromoted.map(x=>x.id));
      const promotedIds=rankedIds.filter(id=>matchingSet.has(id));
      const totalPages=Math.max(1,Math.ceil(total/p.limit));
      const dedicatedPromotedIds=promotedIds.slice(0,totalPages*slotCount);
      const promotedOffset=(p.page-1)*slotCount;
      const promotedSlice=dedicatedPromotedIds.slice(promotedOffset,promotedOffset+slotCount);
      const start=(p.page-1)*p.limit;
      const priorDedicated=Math.min(dedicatedPromotedIds.length,promotedOffset);
      const normalSkip=Math.max(0,start-priorDedicated);
      const normalTake=Math.max(0,p.limit-promotedSlice.length);
      const [promotedRecords,normalItems]=await Promise.all([
        promotedSlice.length?prisma.listing.findMany({where:{...where,id:{in:promotedSlice}},include:{category:true,vehicle:true,property:true,energy:true}}):Promise.resolve([]),
        normalTake?prisma.listing.findMany({where:{...where,...(dedicatedPromotedIds.length?{id:{notIn:dedicatedPromotedIds}}:{})},include:{category:true,vehicle:true,property:true,energy:true},orderBy:recentOrder,skip:normalSkip,take:normalTake}):Promise.resolve([]),
      ]);
      const promotedMap=new Map(promotedRecords.map(item=>[item.id,item] as const));
      const boosted=promotedSlice.map(id=>promotedMap.get(id)).filter((item):item is NonNullable<typeof item>=>Boolean(item));
      const items=insertBoostedAtLegacySlots(normalItems,boosted,p.limit);
      return reply.send({engine:"postgres",page:p.page,limit:p.limit,total,items:await enrichItems(items)});
    }
    const orderBy = p.sort === "price_asc" ? [{ priceMinor: "asc" as const }, { publishedAt: "desc" as const }] : [{ priceMinor: "desc" as const }, { publishedAt: "desc" as const }];
    const [items, total] = await Promise.all([
      prisma.listing.findMany({ where, include: { category: true, vehicle: true, property: true, energy: true }, orderBy, skip: (p.page - 1) * p.limit, take: p.limit }),
      prisma.listing.count({ where }),
    ]);
    return reply.send({ engine: "postgres", page: p.page, limit: p.limit, total, items: await enrichItems(items) });
  });

  app.get("/search/autocomplete", async (request, reply) => {
    const parsed = z.object({ q: z.string().trim().min(2).max(80) }).safeParse(request.query);
    if (!parsed.success) return reply.send({ suggestions: [] });
    const q = parsed.data.q;
    const [categories, listings, cities] = await Promise.all([
      prisma.category.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { name: true, slug: true }, take: 5 }),
      prisma.listing.findMany({ where: { status: "PUBLISHED", title: { contains: q, mode: "insensitive" } }, select: { id:true,title:true,slug:true,priceMinor:true,currency:true,city:true }, orderBy:[{publishedAt:"desc"},{createdAt:"desc"}], take: 6 }),
      prisma.listing.findMany({ where: { status: "PUBLISHED", city: { contains: q, mode: "insensitive" } }, select: { city: true }, distinct: ["city"], take: 5 }),
    ]);
    const listingIds=listings.map(item=>item.id);
    const covers=listingIds.length?await prisma.$queryRawUnsafe<Array<{listingId:string;publicUrl:string}>>(`SELECT DISTINCT ON (lm."listingId") lm."listingId",lm."publicUrl" FROM "ListingMedia" lm WHERE lm."listingId"=ANY($1::text[]) AND lm."status"='READY' AND lm."publicUrl" IS NOT NULL ORDER BY lm."listingId",lm."isCover" DESC,lm."sortOrder" ASC,lm."createdAt" ASC`,listingIds):[];
    const coverByListing=new Map(covers.map(item=>[item.listingId,item.publicUrl] as const));
    return reply.send({ suggestions: [
      ...categories.map((item) => ({ type: "category", label: item.name, value: item.slug })),
      ...listings.filter((item) => item.title && item.slug).map((item) => ({ type: "listing",id:item.id,label:item.title!,value:item.slug!,imageUrl:coverByListing.get(item.id)??null,priceMinor:item.priceMinor,currency:item.currency,city:item.city })),
      ...cities.filter((item) => item.city).map((item) => ({ type: "city", label: item.city!, value: item.city! })),
    ] });
  });

  app.get("/seo/category/:category/city/:city", async (request, reply) => {
    const parsed = z.object({ category: z.string().min(1), city: z.string().min(1) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_route" });
    const category = await prisma.category.findUnique({ where: { slug: parsed.data.category }, select: { id:true,name: true, slug: true, domain:true } });
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `WITH RECURSIVE category_tree AS (
         SELECT "id" FROM "Category" WHERE "slug"=$1
         UNION ALL
         SELECT c."id" FROM "Category" c JOIN category_tree parent ON c."parentId"=parent."id"
       ) SELECT "id" FROM category_tree`,
      parsed.data.category,
    );
    const categoryIds=rows.map((row)=>row.id);
    const requestedKey=normalizeCityKey(parsed.data.city);
    const cityRows=await prisma.listing.findMany({where:{status:"PUBLISHED",categoryId:{in:categoryIds},city:{not:null}},select:{city:true},distinct:["city"],take:5000});
    const resolvedCity=cityRows.map(x=>x.city).find((value):value is string=>Boolean(value)&&normalizeCityKey(value!)===requestedKey)??parsed.data.city;
    const [total,priceStats,subRows] = await Promise.all([
      prisma.listing.count({ where: { status: "PUBLISHED", categoryId: { in: categoryIds }, city: { equals: resolvedCity, mode: "insensitive" } } }),
      prisma.listing.aggregate({
        where:{status:"PUBLISHED",categoryId:{in:categoryIds},city:{equals:resolvedCity,mode:"insensitive"},priceMinor:{not:null}},
        _min:{priceMinor:true},_max:{priceMinor:true},
      }),
      prisma.$queryRawUnsafe<Array<{slug:string;name:string;count:bigint}>>(
        `WITH RECURSIVE mapped AS (
           SELECT c."id",c."id" AS "rootId" FROM "Category" c WHERE c."parentId"=$1 AND c."isActive"=TRUE
           UNION ALL
           SELECT c."id",m."rootId" FROM "Category" c JOIN mapped m ON c."parentId"=m."id" WHERE c."isActive"=TRUE
         )
         SELECT root."slug",root."name",COUNT(l."id")::bigint AS "count"
         FROM mapped m
         JOIN "Category" root ON root."id"=m."rootId"
         JOIN "Listing" l ON l."categoryId"=m."id"
         WHERE l."status"='PUBLISHED' AND l."city" IS NOT NULL AND LOWER(BTRIM(l."city"))=LOWER(BTRIM($2))
         GROUP BY root."id",root."slug",root."name"
         HAVING COUNT(l."id")>=3
         ORDER BY COUNT(l."id") DESC,root."name" ASC
         LIMIT 12`,category.id,resolvedCity,
      ),
    ]);
    const title=`Petites annonces ${category.name.toLowerCase()} à ${resolvedCity} | Annonces gratuites`;
    const description=`Découvrez ${total} annonce${total>1?"s":""} ${category.name.toLowerCase()} à ${resolvedCity}. Comparez les offres locales, achetez ou vendez près de chez vous et publiez gratuitement sur Petit Annonces.`;
    return reply.send({ category:{name:category.name,slug:category.slug,domain:category.domain}, city:resolvedCity,title,description, canonicalPath: `/c/${category.slug}/${citySlug(resolvedCity)}`, total,price:{minMinor:priceStats._min.priceMinor,maxMinor:priceStats._max.priceMinor,currency:"EUR"},subcategories:subRows.map(row=>({slug:row.slug,name:row.name,count:Number(row.count)})) });
  });
  app.get("/seo/category/:category/cities", async (request, reply) => {
    const parsed=z.object({category:z.string().min(1)}).safeParse(request.params);if(!parsed.success)return reply.code(400).send({error:"invalid_route"});
    const category=await prisma.category.findUnique({where:{slug:parsed.data.category},select:{id:true,name:true,slug:true}});if(!category)return reply.code(404).send({error:"category_not_found"});
    const rows=await prisma.$queryRawUnsafe<Array<{city:string;count:bigint}>>(`WITH RECURSIVE category_tree AS (SELECT "id" FROM "Category" WHERE "slug"=$1 UNION ALL SELECT c."id" FROM "Category" c JOIN category_tree p ON c."parentId"=p."id") SELECT l."city",COUNT(*)::bigint AS count FROM "Listing" l WHERE l."status"='PUBLISHED' AND l."categoryId" IN (SELECT "id" FROM category_tree) AND l."city" IS NOT NULL AND BTRIM(l."city")<>'' GROUP BY l."city" ORDER BY count DESC,l."city" ASC LIMIT 12`,parsed.data.category);
    return reply.send({category:{name:category.name,slug:category.slug},cities:rows.map(r=>({city:r.city,count:Number(r.count)}))});
  });

}
