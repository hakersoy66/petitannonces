import { randomBytes } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { geocodeFrenchLocation } from "./geocoding.js";
import { lookupVehicleByPlate, normalizeFrenchPlate, plateHash } from "./vehicle-data.js";
import { getRuntimeIntegration } from "./admin-control.js";
import { deleteStoredObject } from "./storage.js";
import { categoryAttributeDefinitions } from "./category-attributes.js";
import { rejectListingAttemptForPolicy } from "./listing-content-policy.js";
import { discardListingEditSession, openListingEditSession } from "./listing-edit-session.js";

const idParams = z.object({ id: z.string().min(1) });
const energyClass = z.enum(["A", "B", "C", "D", "E", "F", "G"]);

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
}

async function ensureVehicleHistorySnapshotTable(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VehicleHistorySnapshot" (
    "listingId" text PRIMARY KEY,
    "registrationPlateHash" text NOT NULL,
    "source" text NOT NULL,
    "checkedAt" timestamptz NOT NULL,
    "historyJson" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleHistorySnapshot_plate_idx" ON "VehicleHistorySnapshot" ("registrationPlateHash","checkedAt" DESC)`);
}
async function saveVehicleHistorySnapshot(listingId:string,registrationPlateHash:string,source:string,checkedAt:Date,history:unknown){
  await ensureVehicleHistorySnapshotTable();
  await prisma.$executeRawUnsafe(`INSERT INTO "VehicleHistorySnapshot" ("listingId","registrationPlateHash","source","checkedAt","historyJson","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::jsonb,NOW(),NOW()) ON CONFLICT ("listingId") DO UPDATE SET "registrationPlateHash"=EXCLUDED."registrationPlateHash","source"=EXCLUDED."source","checkedAt"=EXCLUDED."checkedAt","historyJson"=EXCLUDED."historyJson","updatedAt"=NOW()`,listingId,registrationPlateHash,source,checkedAt,JSON.stringify(history??{}));
}
async function latestVehicleHistorySnapshot(registrationPlateHash:string){
  await ensureVehicleHistorySnapshotTable();
  const rows=await prisma.$queryRawUnsafe<Array<{source:string;checkedAt:Date;historyJson:unknown}>>(`SELECT "source","checkedAt","historyJson" FROM "VehicleHistorySnapshot" WHERE "registrationPlateHash"=$1 ORDER BY "checkedAt" DESC LIMIT 1`,registrationPlateHash);
  return rows[0]??null;
}
async function ensureVehicleOfficialReportTable(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VehicleOfficialReport" (
    "listingId" text PRIMARY KEY,
    "histovecUrl" text,
    "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}
function normalizeHistovecUrl(raw:string|null|undefined){
  const value=(raw??"").trim();if(!value)return null;
  try{const u=new URL(value);if(u.protocol!=="https:"||u.username||u.password)return null;const host=u.hostname.toLowerCase();if(host!=="histovec.interieur.gouv.fr")return null;if(!u.pathname.toLowerCase().startsWith("/histovec"))return null;u.hash="";return u.toString();}catch{return null}
}

async function ownedDraft(id: string, userId: string) {
  const listing = await prisma.listing.findFirst({ where: { id, sellerId: userId, status: { in: ["DRAFT", "PENDING", "PUBLISHED", "SUSPENDED", "EXPIRED"] } }, include: { category: true } });
  if (!listing) return null;
  if (listing.status === "DRAFT") return listing;
  if (listing.status === "PENDING") {
    await prisma.$executeRawUnsafe(
      `UPDATE "ModerationCase" SET "status"='CLOSED',"updatedAt"=CURRENT_TIMESTAMP WHERE "targetType"='LISTING' AND "targetId"=$1 AND "status" NOT IN ('RESOLVED','CLOSED')`,
      listing.id,
    );
  }
  return prisma.listing.update({ where: { id: listing.id }, data: { status: "DRAFT", draftSavedAt: new Date() }, include: { category: true } });
}

const propertyEnergySchema = z.object({
  property: z.object({
    transactionType: z.enum(["SALE", "RENTAL"]),
    propertyType: z.string().trim().min(2).max(80),
    surfaceM2: z.number().positive().max(100000),
    rooms: z.number().int().positive().max(1000).nullish(),
    bedrooms: z.number().int().nonnegative().max(1000).nullish(),
    furnished: z.boolean().default(false),
    floor: z.number().int().min(-10).max(300).nullish(),
    totalFloors: z.number().int().positive().max(300).nullish(),
    landM2: z.number().nonnegative().max(10000000).nullish(),
    postalCode: z.string().trim().max(12).nullish(),
    city: z.string().trim().max(120).nullish(),
    countryCode: z.string().trim().length(2).default("FR"),
  }),
  energy: z.discriminatedUnion("isExempt", [
    z.object({ isExempt: z.literal(true), exemptionReason: z.string().trim().min(5).max(300) }),
    z.object({
      isExempt: z.literal(false),
      dpeNumber: z.string().trim().min(8).max(40),
      dpeDate: z.string().date(),
      energyClass,
      climateClass: energyClass,
      energyConsumptionKwhM2Year: z.number().nonnegative().max(10000),
      ghgKgCo2M2Year: z.number().nonnegative().max(10000),
      annualCostMinMinor: z.number().int().nonnegative(),
      annualCostMaxMinor: z.number().int().nonnegative(),
      energyPriceReferenceYears: z.string().trim().min(4).max(80),
    }),
  ]),
});

export async function registerListingRoutes(app: FastifyInstance) {
  app.get("/categories/tree", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=120, s-maxage=600, stale-while-revalidate=1800");
    return reply.send({
      categories: await prisma.category.findMany({
        where: { parentId: null, isActive: true },
        include: { children: { where: { isActive: true }, include: { children: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    });
  });

  app.post("/listings/:id/edit", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const pending = await prisma.listing.findFirst({ where:{id:params.data.id,sellerId:user.id,status:"PENDING"}, select:{id:true} });
    if(pending)return reply.code(409).send({ error:"listing_under_moderation" });
    const session=await openListingEditSession(params.data.id,user.id);
    if(!session)return reply.code(404).send({error:"listing_not_editable"});
    const moderation=await prisma.$queryRawUnsafe<Array<{reasonCode:string|null;statement:string|null;decidedAt:Date|null}>>(`SELECT "decisionReasonCode" AS "reasonCode","decisionStatement" AS "statement","decidedAt" FROM "ModerationCase" WHERE "targetType"='LISTING' AND "targetId"=$1 AND "decisionAction" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`,session.originalListingId);
    return reply.send({editable:true,workingListingId:session.workingListingId,originalListingId:session.originalListingId,previousStatus:session.previousStatus,isolatedEdit:session.session,moderation:moderation[0]??null});
  });

  app.post("/listings/:id/edit/discard", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params=idParams.safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const discarded=await discardListingEditSession(params.data.id,user.id);
    return discarded?reply.send({discarded:true}):reply.send({discarded:false});
  });

  app.get("/listings/:id/draft", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, sellerId: user.id, status: { in: ["DRAFT", "PENDING", "PUBLISHED", "SUSPENDED", "EXPIRED"] } },
      include: { category: true, attributes: { include: { attribute: true } }, vehicle: true, property: true, energy: true },
    });
    if (!listing) return reply.code(404).send({ error: "draft_not_found" });
    const importRows = await prisma.$queryRawUnsafe<Array<{sourceUrl:string|null;sourceType:string;createdAt:Date}>>(`SELECT "sourceUrl","sourceType","createdAt" FROM "ListingImportLog" WHERE "listingId"=$1 AND "userId"=$2 ORDER BY "createdAt" DESC LIMIT 1`, listing.id, user.id).catch(()=>[]);
    let histovecUrl:string|null=null;if(listing.category.domain==="VEHICLE"){await ensureVehicleOfficialReportTable();const reportRows=await prisma.$queryRawUnsafe<Array<{histovecUrl:string|null}>>(`SELECT "histovecUrl" FROM "VehicleOfficialReport" WHERE "listingId"=$1 LIMIT 1`,listing.id).catch(()=>[]);histovecUrl=reportRows[0]?.histovecUrl??null;}
    return reply.send({ importInfo: importRows[0] ?? null, listing: {
      id: listing.id, title: listing.title, description: listing.description, city: listing.city, postalCode: listing.postalCode, region: listing.region, latitude: listing.latitude, longitude: listing.longitude, draftSavedAt: listing.draftSavedAt, category: listing.category,
      attributes: listing.attributes.map((item) => ({ attributeId: item.attributeId, key: item.attribute.key, value: item.valueJson ?? item.valueNumber ?? item.valueBoolean ?? item.valueText })),
      vehicle: listing.vehicle, histovecUrl, property: listing.property, energy: listing.energy,
    } });
  });

  app.post("/listings/ai-description", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const body = z.object({
      categoryId: z.string().min(1),
      title: z.string().trim().min(3).max(120),
      attributes: z.array(z.object({ label: z.string().trim().min(1).max(120), value: z.union([z.string(), z.number(), z.boolean()]) })).max(60).default([]),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const category = await prisma.category.findUnique({ where: { id: body.data.categoryId }, select: { name: true, domain: true } });
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    const facts = body.data.attributes.filter(x => x.value !== "" && x.value !== false).map(x => `${x.label}: ${typeof x.value === "boolean" ? (x.value ? "Oui" : "Non") : x.value}`).slice(0, 24);
    const fallback = () => {
      const domainLead = category.domain === "VEHICLE" ? "Je propose ce véhicule" : category.domain === "REAL_ESTATE" ? "Je propose ce bien" : "Je propose cet article";
      const keyPoints=facts.slice(0,10).map(item=>`• ${item}`).join("\n");
      return [
        `${domainLead} : ${body.data.title}.`,
        keyPoints?`Points clés :\n${keyPoints}`:"",
        "L’annonce est basée uniquement sur les informations renseignées. N’hésitez pas à me contacter via la messagerie Petit Annonces pour toute question complémentaire.",
      ].filter(Boolean).join("\n\n").trim().slice(0,4000);
    };
    const openai = await getRuntimeIntegration("openai");
    const apiKey = (openai?.enabled ? openai.secrets.apiKey : process.env.OPENAI_API_KEY)?.trim();
    const model = String(openai?.enabled ? (openai.config.descriptionModel ?? openai.config.model ?? "") : (process.env.AI_DESCRIPTION_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || "")).trim();
    if (!apiKey || !model) return reply.send({ mode: "assistant", description: fallback() });
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: `Rédige une description d'annonce en français, claire, naturelle et attractive, entre 80 et 160 mots. N'invente aucune information, aucun historique, aucune garantie, aucun état ou équipement non fourni. Utilise uniquement ces données. Catégorie: ${category.name}. Titre: ${body.data.title}. Données: ${facts.join(" | ") || "aucune donnée supplémentaire"}. Format obligatoire : commence par un court paragraphe de 1 à 2 phrases, laisse une ligne vide, puis écris "Points clés :" et présente les informations utiles sur des lignes séparées commençant par le caractère •. Termine par une ligne vide puis un court paragraphe de conclusion. Ne renvoie jamais tout le contenu sous forme d'un seul paragraphe compact. Conserve les retours à la ligne. N'utilise ni titre Markdown ni texte en gras.`, max_output_tokens: 420 }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return reply.send({ mode: "assistant", description: fallback() });
      const payload = await response.json() as any;
      const direct = typeof payload.output_text === "string" ? payload.output_text : null;
      const nested = Array.isArray(payload.output) ? payload.output.flatMap((item:any)=>Array.isArray(item?.content)?item.content:[]).find((part:any)=>part?.type==="output_text")?.text : null;
      const description = String(direct ?? nested ?? "").trim().slice(0,4000);
      return reply.send({ mode: description ? "ai" : "assistant", description: description || fallback() });
    } catch {
      return reply.send({ mode: "assistant", description: fallback() });
    }
  });

  app.get("/categories/:slug/attributes", async (request, reply) => {
    const params = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const category = await prisma.category.findUnique({ where: { slug: params.data.slug } });
    if (!category) return reply.code(404).send({ error: "category_not_found" });
    const attributes = await categoryAttributeDefinitions(category.id);
    return reply.send({ category: { ...category, attributes } });
  });

  app.get("/categories/:slug/filter-attributes", async (request, reply) => {
    const params=z.object({slug:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const query=z.object({brand:z.string().trim().max(100).optional()}).safeParse(request.query);if(!query.success)return reply.code(400).send({error:"invalid_filter_query"});
    const category=await prisma.category.findUnique({where:{slug:params.data.slug},select:{id:true,name:true,slug:true,domain:true}});if(!category)return reply.code(404).send({error:"category_not_found"});
    const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`WITH RECURSIVE category_tree AS (SELECT "id" FROM "Category" WHERE "slug"=$1 UNION ALL SELECT c."id" FROM "Category" c JOIN category_tree p ON c."parentId"=p."id") SELECT "id" FROM category_tree`,params.data.slug);
    const ids=rows.map(r=>r.id);
    const defs=await prisma.categoryAttribute.findMany({where:{categoryId:{in:ids},filterable:true},include:{options:{orderBy:{sortOrder:"asc"}}},orderBy:[{sortOrder:"asc"},{label:"asc"}]});
    type Option={value:string;label:string;count?:number};
    type FacetAttribute={key:string;label:string;type:string;unit:string|null;options:Option[];sortOrder:number;min?:number;max?:number;dependsOn?:string};
    const grouped=new Map<string,FacetAttribute>();
    for(const def of defs){const existing=grouped.get(def.key);if(existing&&existing.type!==def.type)continue;const target=existing??{key:def.key,label:def.label,type:def.type,unit:def.unit,options:[],sortOrder:def.sortOrder};const seen=new Set(target.options.map(o=>o.value));for(const option of def.options){if(!seen.has(option.value)){target.options.push({value:option.value,label:option.label});seen.add(option.value)}}grouped.set(def.key,target)}

    const [textRows,numberRows,booleanRows,priceRows]=await Promise.all([
      prisma.$queryRawUnsafe<Array<{key:string;value:string;count:bigint}>>(`SELECT a."key",v."valueText" AS value,COUNT(DISTINCT l."id")::bigint AS count FROM "ListingAttributeValue" v JOIN "CategoryAttribute" a ON a."id"=v."attributeId" JOIN "Listing" l ON l."id"=v."listingId" WHERE a."categoryId"=ANY($1::text[]) AND l."status"='PUBLISHED' AND v."valueText" IS NOT NULL AND btrim(v."valueText")<>'' GROUP BY a."key",v."valueText" ORDER BY count DESC,v."valueText" ASC`,ids),
      prisma.$queryRawUnsafe<Array<{key:string;min:number|null;max:number|null}>>(`SELECT a."key",MIN(v."valueNumber") AS min,MAX(v."valueNumber") AS max FROM "ListingAttributeValue" v JOIN "CategoryAttribute" a ON a."id"=v."attributeId" JOIN "Listing" l ON l."id"=v."listingId" WHERE a."categoryId"=ANY($1::text[]) AND l."status"='PUBLISHED' AND v."valueNumber" IS NOT NULL GROUP BY a."key"`,ids),
      prisma.$queryRawUnsafe<Array<{key:string;value:boolean;count:bigint}>>(`SELECT a."key",v."valueBoolean" AS value,COUNT(DISTINCT l."id")::bigint AS count FROM "ListingAttributeValue" v JOIN "CategoryAttribute" a ON a."id"=v."attributeId" JOIN "Listing" l ON l."id"=v."listingId" WHERE a."categoryId"=ANY($1::text[]) AND l."status"='PUBLISHED' AND v."valueBoolean" IS NOT NULL GROUP BY a."key",v."valueBoolean"`,ids),
      prisma.$queryRawUnsafe<Array<{min:number|null;max:number|null;count:bigint}>>(`SELECT MIN("priceMinor")/100.0 AS min,MAX("priceMinor")/100.0 AS max,COUNT(*)::bigint AS count FROM "Listing" WHERE "categoryId"=ANY($1::text[]) AND "status"='PUBLISHED' AND "priceMinor" IS NOT NULL`,ids),
    ]);

    const valueCounts=new Map<string,Array<{value:string;count:number}>>();
    for(const row of textRows){const current=valueCounts.get(row.key)??[];current.push({value:row.value,count:Number(row.count)});valueCounts.set(row.key,current)}
    const numericRanges=new Map(numberRows.map(row=>[row.key,{min:row.min==null?undefined:Number(row.min),max:row.max==null?undefined:Number(row.max)}] as const));
    const booleanCounts=new Map<string,{trueCount:number;falseCount:number}>();
    for(const row of booleanRows){const current=booleanCounts.get(row.key)??{trueCount:0,falseCount:0};if(row.value)current.trueCount=Number(row.count);else current.falseCount=Number(row.count);booleanCounts.set(row.key,current)}

    if(category.domain==="VEHICLE"){
      const selectedBrand=query.data.brand?.trim()||null;
      const [vehicleValues,vehicleRanges]=await Promise.all([
        prisma.$queryRawUnsafe<Array<{key:string;value:string;count:bigint}>>(`SELECT x.key,x.value,COUNT(*)::bigint AS count FROM "VehicleDetails" v JOIN "Listing" l ON l."id"=v."listingId" CROSS JOIN LATERAL (VALUES ('brand',v."make"),('model',v."model"),('fuel',v."fuel"),('gearbox',v."transmission"),('doors',v."doors"::text),('color',v."color"),('bodyStyle',v."bodyType")) AS x(key,value) WHERE l."categoryId"=ANY($1::text[]) AND l."status"='PUBLISHED' AND x.value IS NOT NULL AND btrim(x.value)<>'' AND (x.key<>'model' OR $2::text IS NULL OR lower(v."make")=lower($2)) GROUP BY x.key,x.value ORDER BY count DESC,x.value ASC`,ids,selectedBrand),
        prisma.$queryRawUnsafe<Array<{mileageMin:number|null;mileageMax:number|null;fiscalPowerMin:number|null;fiscalPowerMax:number|null;powerKwMin:number|null;powerKwMax:number|null;seatsMin:number|null;seatsMax:number|null}>>(`SELECT MIN(v."mileageKm")::float AS "mileageMin",MAX(v."mileageKm")::float AS "mileageMax",MIN(v."fiscalPowerCv")::float AS "fiscalPowerMin",MAX(v."fiscalPowerCv")::float AS "fiscalPowerMax",MIN(v."powerKw")::float AS "powerKwMin",MAX(v."powerKw")::float AS "powerKwMax",MIN(v."seats")::float AS "seatsMin",MAX(v."seats")::float AS "seatsMax" FROM "VehicleDetails" v JOIN "Listing" l ON l."id"=v."listingId" WHERE l."categoryId"=ANY($1::text[]) AND l."status"='PUBLISHED'`,ids),
      ]);
      const byKey=new Map<string,Array<{value:string;count:number}>>();for(const row of vehicleValues){const current=byKey.get(row.key)??[];current.push({value:row.value,count:Number(row.count)});byKey.set(row.key,current)}
      for(const [key,items] of byKey)valueCounts.set(key,items);
      const vr=vehicleRanges[0];if(vr){
        if(vr.mileageMin!=null||vr.mileageMax!=null)numericRanges.set("mileage",{min:vr.mileageMin??undefined,max:vr.mileageMax??undefined});
        if(vr.fiscalPowerMin!=null||vr.fiscalPowerMax!=null)numericRanges.set("fiscalPower",{min:vr.fiscalPowerMin??undefined,max:vr.fiscalPowerMax??undefined});
        if(vr.powerKwMin!=null||vr.powerKwMax!=null)numericRanges.set("powerKw",{min:vr.powerKwMin??undefined,max:vr.powerKwMax??undefined});
        if(vr.seatsMin!=null||vr.seatsMax!=null)numericRanges.set("seats",{min:vr.seatsMin??undefined,max:vr.seatsMax??undefined});
      }
    }

    const hasBrand=grouped.has("brand");
    for(const target of grouped.values()){
      const counts=valueCounts.get(target.key)??[];const countMap=new Map(counts.map(x=>[x.value.toLocaleLowerCase("fr"),x.count] as const));
      if((target.key==="brand"||target.key==="model")&&counts.length){target.options=counts.slice(0,120).map(x=>({value:x.value,label:x.value,count:x.count}))}
      else if(target.options.length){target.options=target.options.map(option=>({...option,count:countMap.get(option.value.toLocaleLowerCase("fr"))??0}))}
      const range=numericRanges.get(target.key);if(range){target.min=range.min;target.max=range.max}
      if(target.type==="BOOLEAN"){const bc=booleanCounts.get(target.key);if(bc)target.options=[{value:"true",label:"Oui",count:bc.trueCount},{value:"false",label:"Non",count:bc.falseCount}]}
      if(target.key==="model"&&hasBrand)target.dependsOn="brand";
    }
    const attributes=[...grouped.values()].sort((a,b)=>a.sortOrder-b.sortOrder||a.label.localeCompare(b.label,"fr")).slice(0,18);
    const price=priceRows[0];
    return reply.send({category,attributes,priceRange:{min:price?.min==null?null:Number(price.min),max:price?.max==null?null:Number(price.max),count:Number(price?.count??0)},facetsVersion:2});
  });

  app.post("/listings/drafts", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const body = z.object({ categoryId: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const category = await prisma.category.findUnique({ where: { id: body.data.categoryId } });
    if (!category || !category.isActive) return reply.code(404).send({ error: "category_not_found" });
    const listing = await prisma.listing.create({ data: { sellerId: user.id, categoryId: category.id, draftSavedAt: null }, include: { category: true } });
    return reply.code(201).send({ listing, transient: true });
  });

  app.post("/listings/:id/save-draft", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id, status: "DRAFT" }, select: { id: true } });
    if (!listing) return reply.code(409).send({ error: "draft_required" });
    const policyBlock=await rejectListingAttemptForPolicy({request,userId:user.id,listingId:listing.id});
    if(policyBlock)return reply.code(423).send({error:"listing_content_policy_violation",message:"Cette annonce contient un contenu interdit ou des coordonnées directes. Elle n’a pas été enregistrée comme brouillon.",reasons:policyBlock.signals,redirect:policyBlock.redirect});
    await prisma.listing.update({ where: { id: listing.id }, data: { draftSavedAt: new Date() } });
    return reply.send({ saved: true });
  });

  app.patch("/listings/:id/category", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params=idParams.safeParse(request.params);const body=z.object({categoryId:z.string().min(1)}).safeParse(request.body);
    if(!params.success||!body.success){
      request.log.warn({listingId:params.success?params.data.id:null,issues:body.success?[]:body.error.issues.map(issue=>({path:issue.path.join("."),code:issue.code}))},"listing autosave validation failed");
      return reply.code(400).send({error:"invalid_request",details:body.success?undefined:body.error.flatten()});
    }
    const draft=await ownedDraft(params.data.id,user.id);if(!draft)return reply.code(404).send({error:"draft_not_found"});
    const category=await prisma.category.findFirst({where:{id:body.data.categoryId,isActive:true}});if(!category)return reply.code(404).send({error:"category_not_found"});
    if(category.id===draft.categoryId)return reply.send({listing:draft,categoryChanged:false});
    const [oldValues,newDefinitions]=await Promise.all([
      prisma.listingAttributeValue.findMany({where:{listingId:draft.id},include:{attribute:true}}),
      categoryAttributeDefinitions(category.id),
    ]);
    const nextByKey=new Map(newDefinitions.map(definition=>[definition.key,definition] as const));
    const migrated=oldValues.flatMap(value=>{
      const next=nextByKey.get(value.attribute.key);if(!next||next.type!==value.attribute.type)return[];
      if(next.type==="SELECT"&&value.valueText&&!next.options.some(option=>option.value===value.valueText))return[];
      if(next.type==="MULTISELECT"){
        const selected=Array.isArray(value.valueJson)?value.valueJson.filter((item):item is string=>typeof item==="string"):[];
        const allowed=new Set(next.options.map(option=>option.value));
        if(selected.some(item=>!allowed.has(item)))return[];
      }
      return[{attributeId:next.id,valueText:value.valueText,valueNumber:value.valueNumber,valueBoolean:value.valueBoolean,...(value.valueJson===null?{}:{valueJson:value.valueJson as any})}];
    });
    await prisma.$transaction(async tx=>{
      await tx.listingAttributeValue.deleteMany({where:{listingId:draft.id}});
      for(const value of migrated)await tx.listingAttributeValue.create({data:{listingId:draft.id,...value}});
      if(draft.category.domain==="VEHICLE"&&category.domain!=="VEHICLE")await tx.vehicleDetails.deleteMany({where:{listingId:draft.id}});
      if(draft.category.domain==="REAL_ESTATE"&&category.domain!=="REAL_ESTATE"){
        await tx.propertyEnergyPerformance.deleteMany({where:{listingId:draft.id}});
        await tx.propertyDetails.deleteMany({where:{listingId:draft.id}});
      }
      await tx.listing.update({where:{id:draft.id},data:{categoryId:category.id}});
    });
    return reply.send({listing:{...draft,categoryId:category.id,category},categoryChanged:true,migratedAttributes:migrated.length});
  });

  app.post("/listings/:id/discard-transient", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id, status: "DRAFT", draftSavedAt: null }, select: { id: true } });
    if (!listing) return reply.code(204).send();
    const protectedRows = await prisma.$queryRawUnsafe<Array<{blocked:boolean}>>(`SELECT (EXISTS(SELECT 1 FROM "ModerationCase" WHERE "targetType"='LISTING' AND "targetId"=$1) OR EXISTS(SELECT 1 FROM "MarketplaceOrder" WHERE "listingId"=$1)) AS blocked`,listing.id);
    if (protectedRows[0]?.blocked) return reply.code(204).send();
    const media = await prisma.$queryRawUnsafe<Array<{objectKey:string}>>(`SELECT "objectKey" FROM "ListingMedia" WHERE "listingId"=$1`,listing.id).catch(()=>[]);
    await prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`DELETE FROM "ListingMedia" WHERE "listingId"=$1`,listing.id).catch(()=>undefined);
      await tx.$executeRawUnsafe(`DELETE FROM "ListingImportLog" WHERE "listingId"=$1`,listing.id).catch(()=>undefined);
      await tx.listing.deleteMany({ where: { id: listing.id, sellerId: user.id, status: "DRAFT", draftSavedAt: null } });
    });
    for(const item of media)await deleteStoredObject(item.objectKey).catch(()=>{});
    return reply.code(204).send();
  });

  app.patch("/listings/:id/basics", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({
      title: z.string().trim().min(5).max(120).optional(),
      description: z.string().trim().min(20).max(12000).optional(),
      priceMinor: z.number().int().nonnegative().nullable().optional(),
      currency: z.literal("EUR").optional(),
      city: z.string().trim().min(2).max(120).optional(),
      postalCode: z.string().trim().min(4).max(12).optional(),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const draft = await ownedDraft(params.data.id, user.id); if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    const data: any = { ...body.data };
    if (body.data.city !== undefined || body.data.postalCode !== undefined) {
      const city = body.data.city ?? draft.city ?? "";
      const postalCode = body.data.postalCode ?? draft.postalCode ?? "";
      const geo = city && postalCode ? await geocodeFrenchLocation(city, postalCode) : null;
      data.city = geo?.city ?? (city || null);
      data.postalCode = geo?.postalCode ?? (postalCode || null);
      data.region = geo?.region ?? draft.region ?? null;
      data.latitude = geo?.latitude ?? null;
      data.longitude = geo?.longitude ?? null;
    }
    return reply.send({ listing: await prisma.listing.update({ where: { id: draft.id }, data }) });
  });

  app.patch("/listings/:id/autosave", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params=idParams.safeParse(request.params);
    const body=z.object({
      title:z.string().max(120).optional(), description:z.string().max(12000).optional(),
      city:z.string().max(120).optional(), postalCode:z.string().max(12).optional(),
      attributes:z.array(z.object({attributeId:z.string().min(1),value:z.unknown().optional()})).max(100).optional(),
    }).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const draft=await prisma.listing.findFirst({where:{id:params.data.id,sellerId:user.id,status:"DRAFT"},include:{category:true}});
    if(!draft)return reply.code(409).send({error:"draft_required"});
    const update:any={};
    if(body.data.title!==undefined)update.title=body.data.title.trim()||null;
    if(body.data.description!==undefined)update.description=body.data.description.trim()||null;
    if(body.data.city!==undefined)update.city=body.data.city.trim()||null;
    if(body.data.postalCode!==undefined)update.postalCode=body.data.postalCode.trim()||null;
    const attrs=body.data.attributes??[];
    const allowedDefinitions=attrs.length?await categoryAttributeDefinitions(draft.categoryId):[];
    const requestedIds=new Set(attrs.map(x=>x.attributeId));
    const definitions=allowedDefinitions.filter(definition=>requestedIds.has(definition.id));
    const byId=new Map(definitions.map(d=>[d.id,d]));
    await prisma.$transaction(async tx=>{
      if(Object.keys(update).length)await tx.listing.update({where:{id:draft.id},data:update});
      for(const item of attrs){
        const definition=byId.get(item.attributeId); if(!definition)continue;
        const empty=item.value===undefined||item.value===null||item.value===""||(Array.isArray(item.value)&&item.value.length===0);
        if(empty){await tx.listingAttributeValue.deleteMany({where:{listingId:draft.id,attributeId:definition.id}});continue;}
        const data:any={valueText:null,valueNumber:null,valueBoolean:null,valueJson:null};
        if(definition.type==="NUMBER"&&typeof item.value==="number"&&Number.isFinite(item.value))data.valueNumber=item.value;
        else if(definition.type==="BOOLEAN"&&typeof item.value==="boolean")data.valueBoolean=item.value;
        else if(definition.type==="MULTISELECT"&&Array.isArray(item.value)&&item.value.every(v=>typeof v==="string"))data.valueJson=item.value;
        else if(typeof item.value==="string")data.valueText=item.value.trim().slice(0,1000);
        else continue;
        await tx.listingAttributeValue.upsert({where:{listingId_attributeId:{listingId:draft.id,attributeId:definition.id}},create:{listingId:draft.id,attributeId:definition.id,...data},update:data});
      }
    });
    return reply.send({saved:true,savedAt:new Date().toISOString()});
  });

  app.put("/listings/:id/attributes", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({ values: z.array(z.object({ attributeId: z.string().min(1), value: z.unknown() })).max(100) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const draft = await ownedDraft(params.data.id, user.id); if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    const allowedDefinitions = await categoryAttributeDefinitions(draft.categoryId);
    const requestedIds = new Set(body.data.values.map(v => v.attributeId));
    const definitions = allowedDefinitions.filter(definition => requestedIds.has(definition.id));
    const byId = new Map(definitions.map(d => [d.id, d]));
    if (definitions.length !== body.data.values.length) return reply.code(400).send({ error: "attribute_not_in_category" });

    try {
      await prisma.$transaction(async tx => {
      for (const item of body.data.values) {
        const definition = byId.get(item.attributeId)!;
        const data: any = { valueText: null, valueNumber: null, valueBoolean: null };
        if (definition.type === "NUMBER") {
          if (typeof item.value !== "number" || !Number.isFinite(item.value)) throw new Error("invalid_number_attribute");
          data.valueNumber = item.value;
        } else if (definition.type === "BOOLEAN") {
          if (typeof item.value !== "boolean") throw new Error("invalid_boolean_attribute");
          data.valueBoolean = item.value;
        } else if (definition.type === "MULTISELECT") {
          if (!Array.isArray(item.value) || !item.value.every(v => typeof v === "string")) throw new Error("invalid_multiselect_attribute");
          const allowed = new Set(definition.options.map(o => o.value));
          if (item.value.some(v => !allowed.has(v))) throw new Error("invalid_attribute_option");
          data.valueJson = item.value;
        } else {
          if (typeof item.value !== "string") throw new Error("invalid_text_attribute");
          if (definition.type === "SELECT" && !definition.options.some(o => o.value === item.value)) throw new Error("invalid_attribute_option");
          data.valueText = item.value.trim().slice(0, 1000);
        }
        await tx.listingAttributeValue.upsert({ where: { listingId_attributeId: { listingId: draft.id, attributeId: definition.id } }, create: { listingId: draft.id, attributeId: definition.id, ...data }, update: data });
      }
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid_attribute_value";
      if (["invalid_number_attribute","invalid_boolean_attribute","invalid_multiselect_attribute","invalid_attribute_option","invalid_text_attribute"].includes(code)) return reply.code(400).send({ error: code });
      throw error;
    }
    return reply.send({ saved: true });
  });

  app.post("/listings/:id/vehicle/from-plate", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({ registrationPlate: z.string().trim().min(5).max(20) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const draft = await ownedDraft(params.data.id, user.id); if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    if (draft.category.domain !== "VEHICLE") return reply.code(400).send({ error: "vehicle_category_required" });

    try {
      const normalized = normalizeFrenchPlate(body.data.registrationPlate);
      const normalizedHash=plateHash(normalized);const cacheCutoff=new Date(Date.now()-30*24*60*60*1000);
      const cached=await prisma.vehicleDetails.findFirst({where:{registrationPlateHash:normalizedHash,dataVerifiedAt:{gte:cacheCutoff}},orderBy:{dataVerifiedAt:"desc"}});
      const cachedHistory=cached?await latestVehicleHistorySnapshot(normalizedHash):null;
      if(cached&&cachedHistory){
        const vehicle={registrationPlateHash:normalizedHash,registrationPlateLast4:normalized.replace(/-/g,"").slice(-4),dataSource:cached.dataSource,dataVerifiedAt:cached.dataVerifiedAt,make:cached.make,model:cached.model,version:cached.version,firstRegistrationDate:cached.firstRegistrationDate,modelYear:cached.modelYear,fuel:cached.fuel,transmission:cached.transmission,bodyType:cached.bodyType,powerKw:cached.powerKw,fiscalPowerCv:cached.fiscalPowerCv,co2GKm:cached.co2GKm,euroStandard:cached.euroStandard,seats:cached.seats,doors:cached.doors,color:cached.color};
        const wizardAttributes:Record<string,string|number|boolean>={};for(const [key,value] of Object.entries({brand:cached.make,model:cached.model,firstRegistration:cached.firstRegistrationDate?.toISOString().slice(0,10),fuel:cached.fuel,gearbox:cached.transmission,fiscalPower:cached.fiscalPowerCv,powerKw:cached.powerKw,seats:cached.seats,doors:cached.doors!=null?String(cached.doors):null,color:cached.color,bodyStyle:cached.bodyType}))if(value!==null&&value!==undefined&&value!=="")wizardAttributes[key]=value as string|number|boolean;
        return reply.send({vehicle,wizardAttributes,plateStored:false,cached:true,verifiedAt:cached.dataVerifiedAt,previewOnly:true});
      }
      const v = await lookupVehicleByPlate(normalized);
      const data = {
        registrationPlateHash: normalizedHash, registrationPlateLast4: normalized.replace(/-/g, "").slice(-4), dataSource: v.source, dataVerifiedAt: new Date(),
        make: v.make ?? null, model: v.model ?? null, version: v.version ?? null, firstRegistrationDate: v.firstRegistrationDate ? new Date(v.firstRegistrationDate) : null,
        modelYear: v.modelYear ?? null, fuel: v.fuel ?? null, transmission: v.transmission ?? null, bodyType: v.bodyType ?? null, powerKw: v.powerKw ?? null,
        fiscalPowerCv: v.fiscalPowerCv ?? null, co2GKm: v.co2GKm ?? null, euroStandard: v.euroStandard ?? null, seats: v.seats ?? null, doors: v.doors ?? null, color: v.color ?? null,
      };
      const vehicle = data;
      return reply.send({ vehicle, wizardAttributes: v.wizardAttributes ?? {}, plateStored: false, cached:false, previewOnly:true });
    } catch (error) {
      const code = error instanceof Error ? error.message : "vehicle_lookup_failed";
      const status = code === "invalid_registration_plate" ? 400 : code === "vehicle_not_found" ? 404 : code === "vehicle_data_provider_not_configured" ? 503 : 502;
      return reply.code(status).send({ error: code });
    }
  });

  app.put("/listings/:id/vehicle/histovec", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params=idParams.safeParse(request.params);const body=z.object({url:z.string().trim().max(1200).nullable()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const draft=await ownedDraft(params.data.id,user.id);if(!draft)return reply.code(404).send({error:"draft_not_found"});
    if(draft.category.domain!=="VEHICLE")return reply.code(400).send({error:"vehicle_category_required"});
    const raw=body.data.url??"";const normalized=raw.trim()?normalizeHistovecUrl(raw):null;
    if(raw.trim()&&!normalized)return reply.code(400).send({error:"invalid_histovec_url"});
    await ensureVehicleOfficialReportTable();
    if(!normalized){await prisma.$executeRawUnsafe(`DELETE FROM "VehicleOfficialReport" WHERE "listingId"=$1`,draft.id);return reply.send({saved:true,histovecUrl:null});}
    await prisma.$executeRawUnsafe(`INSERT INTO "VehicleOfficialReport" ("listingId","histovecUrl","createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW()) ON CONFLICT ("listingId") DO UPDATE SET "histovecUrl"=EXCLUDED."histovecUrl","updatedAt"=NOW()`,draft.id,normalized);
    return reply.send({saved:true,histovecUrl:normalized});
  });

  app.put("/listings/:id/vehicle", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params);
    const body = z.object({
      make: z.string().trim().max(100).nullish(), model: z.string().trim().max(120).nullish(), version: z.string().trim().max(160).nullish(),
      firstRegistrationDate: z.string().date().nullish(), modelYear: z.number().int().min(1900).max(2100).nullish(), fuel: z.string().trim().max(80).nullish(),
      transmission: z.string().trim().max(80).nullish(), bodyType: z.string().trim().max(80).nullish(), powerKw: z.number().int().nonnegative().nullish(),
      fiscalPowerCv: z.number().int().nonnegative().nullish(), co2GKm: z.number().int().nonnegative().nullish(), euroStandard: z.string().trim().max(40).nullish(),
      seats: z.number().int().positive().max(100).nullish(), doors: z.number().int().positive().max(20).nullish(), color: z.string().trim().max(80).nullish(), mileageKm: z.number().int().nonnegative().max(5000000).nullish(),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const draft = await ownedDraft(params.data.id, user.id); if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    if (draft.category.domain !== "VEHICLE") return reply.code(400).send({ error: "vehicle_category_required" });
    const data = { ...body.data, firstRegistrationDate: body.data.firstRegistrationDate ? new Date(body.data.firstRegistrationDate) : null };
    return reply.send({ vehicle: await prisma.vehicleDetails.upsert({ where: { listingId: draft.id }, create: { listingId: draft.id, ...data }, update: data }) });
  });

  app.put("/listings/:id/property-energy", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params); const body = propertyEnergySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request", details: body.success ? undefined : body.error.flatten() });
    const draft = await ownedDraft(params.data.id, user.id); if (!draft) return reply.code(404).send({ error: "draft_not_found" });
    if (draft.category.domain !== "REAL_ESTATE") return reply.code(400).send({ error: "real_estate_category_required" });
    const { property, energy } = body.data;
    if (!energy.isExempt && energy.annualCostMaxMinor < energy.annualCostMinMinor) return reply.code(400).send({ error: "invalid_energy_cost_range" });
    const geo = property.city && property.postalCode ? await geocodeFrenchLocation(property.city, property.postalCode) : null;

    const result = await prisma.$transaction(async tx => {
      const savedProperty = await tx.propertyDetails.upsert({ where: { listingId: draft.id }, create: { listingId: draft.id, ...property }, update: property });
      const energyData = energy.isExempt ? {
        isExempt: true, exemptionReason: energy.exemptionReason, dpeNumber: null, dpeDate: null, validUntil: null, energyClass: null, climateClass: null,
        energyConsumptionKwhM2Year: null, ghgKgCo2M2Year: null, annualCostMinMinor: null, annualCostMaxMinor: null, energyPriceReferenceYears: null, excessiveConsumption: false,
      } : {
        isExempt: false, exemptionReason: null, dpeNumber: energy.dpeNumber, dpeDate: new Date(energy.dpeDate),
        validUntil: new Date(new Date(energy.dpeDate).setFullYear(new Date(energy.dpeDate).getFullYear() + 10)), energyClass: energy.energyClass, climateClass: energy.climateClass,
        energyConsumptionKwhM2Year: energy.energyConsumptionKwhM2Year, ghgKgCo2M2Year: energy.ghgKgCo2M2Year, annualCostMinMinor: energy.annualCostMinMinor,
        annualCostMaxMinor: energy.annualCostMaxMinor, energyPriceReferenceYears: energy.energyPriceReferenceYears, excessiveConsumption: energy.energyClass === "F" || energy.energyClass === "G",
      };
      const savedEnergy = await tx.propertyEnergyPerformance.upsert({ where: { listingId: draft.id }, create: { listingId: draft.id, ...energyData }, update: energyData });
      await tx.listing.update({ where: { id: draft.id }, data: { city: geo?.city ?? property.city ?? null, postalCode: geo?.postalCode ?? property.postalCode ?? null, region: geo?.region ?? null, latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null } });
      return { property: savedProperty, energy: savedEnergy };
    });
    return reply.send(result);
  });

  app.post("/listings/:id/submit", async (request, reply) => {
    const user = await requireListingUser(request, reply); if (!user) return;
    const params = idParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const listing = await prisma.listing.findFirst({ where: { id: params.data.id, sellerId: user.id, status: "DRAFT" }, include: { category: { include: { attributes: { where: { required: true } } } }, attributes: true, vehicle: true, property: true, energy: true } });
    if (!listing) return reply.code(404).send({ error: "draft_not_found" });

    const errors: string[] = []; const warnings: string[] = [];
    if (!listing.title || listing.title.trim().length < 5) errors.push("title_required");
    if (!listing.description || listing.description.trim().length < 20) errors.push("description_required");
    if (!listing.city) errors.push("city_required");
    if (!listing.postalCode) errors.push("postal_code_required");
    const setIds = new Set(listing.attributes.map(a => a.attributeId));
    const realEstateDedicatedKeys = new Set(["propertyType","surface","rooms","bedrooms","floor","furnished","dpe","ges"]);
    for (const a of listing.category.attributes) if (!(listing.category.domain === "REAL_ESTATE" && realEstateDedicatedKeys.has(a.key)) && !setIds.has(a.id)) errors.push(`required_attribute:${a.key}`);
    if (listing.category.domain === "VEHICLE" && !listing.vehicle) errors.push("vehicle_details_required");

    if (listing.category.domain === "REAL_ESTATE") {
      if (!listing.property) errors.push("property_details_required");
      if (!listing.energy) errors.push("energy_performance_required");
      else if (!listing.energy.isExempt) {
        if (!listing.energy.dpeNumber) errors.push("dpe_number_required");
        if (!listing.energy.dpeDate || listing.energy.dpeDate < new Date("2021-07-01T00:00:00.000Z") || listing.energy.dpeDate > new Date()) errors.push("valid_dpe_date_required");
        if (!listing.energy.energyClass) errors.push("energy_class_required");
        if (!listing.energy.climateClass) errors.push("climate_class_required");
        if (listing.energy.annualCostMinMinor === null || listing.energy.annualCostMaxMinor === null) errors.push("annual_energy_cost_required");
        if (!listing.energy.energyPriceReferenceYears) errors.push("energy_price_reference_years_required");
        if (listing.property?.transactionType === "RENTAL" && listing.energy.energyClass === "G") warnings.push("rental_dpe_g_requires_eligibility_review");
      } else if (!listing.energy.exemptionReason) errors.push("dpe_exemption_reason_required");
    }

    if (errors.length) return reply.code(422).send({ ready: false, errors, warnings });
    const slug = `${slugify(listing.title!)}-${randomBytes(4).toString("hex")}`;
    return reply.send({ ready: true, listing: await prisma.listing.update({ where: { id: listing.id }, data: { status: "PENDING", slug } }), warnings });
  });
}
