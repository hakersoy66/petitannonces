import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";
import { getRuntimeIntegration } from "./admin-control.js";
import { paySupplierFulfillment, syncSupplierFulfillment } from "./supplier-fulfillment.js";

const PROVIDERS=["CJ","ALIEXPRESS"] as const;
type Provider=(typeof PROVIDERS)[number];

type CjToken={accessToken:string;refreshToken?:string;expiresAt:number};
let cjToken:CjToken|null=null;

export async function ensureSupplierCatalogSchema(){
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SupplierProviderConfig" (
      "provider" TEXT PRIMARY KEY,
      "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
      "fulfillmentMode" TEXT NOT NULL DEFAULT 'MANUAL',
      "marginBps" INTEGER NOT NULL DEFAULT 3000,
      "maxDeliveryDays" INTEGER NOT NULL DEFAULT 10,
      "minRetailMarginMinor" INTEGER NOT NULL DEFAULT 500,
      "autoPublish" BOOLEAN NOT NULL DEFAULT FALSE,
      "excludedCategories" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierProviderConfig" ("provider","enabled","fulfillmentMode","marginBps","maxDeliveryDays","autoPublish")
    VALUES ('CJ',FALSE,'AUTOMATIC',3000,10,FALSE),('ALIEXPRESS',FALSE,'MANUAL',3500,14,FALSE)
    ON CONFLICT ("provider") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SupplierCatalogProduct" (
      "id" TEXT PRIMARY KEY,
      "provider" TEXT NOT NULL,
      "externalProductId" TEXT NOT NULL,
      "externalVariantId" TEXT NOT NULL DEFAULT '',
      "title" TEXT NOT NULL,
      "description" TEXT,
      "sourceUrl" TEXT,
      "primaryImageUrl" TEXT,
      "images" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "sourceCategoryId" TEXT,
      "mappedCategoryId" TEXT REFERENCES "Category"("id") ON DELETE SET NULL,
      "sourcePriceMinor" INTEGER,
      "sourceCurrency" TEXT NOT NULL DEFAULT 'EUR',
      "estimatedShippingMinor" INTEGER,
      "retailPriceMinor" INTEGER,
      "stockQuantity" INTEGER,
      "stockStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
      "warehouseCountryCode" TEXT,
      "deliveryDaysMin" INTEGER,
      "deliveryDaysMax" INTEGER,
      "fulfillmentMode" TEXT NOT NULL DEFAULT 'MANUAL',
      "complianceStatus" TEXT NOT NULL DEFAULT 'PENDING',
      "complianceData" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
      "publishedListingId" TEXT REFERENCES "Listing"("id") ON DELETE SET NULL,
      "raw" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "lastSyncedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE ("provider","externalProductId","externalVariantId")
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SupplierProviderConfig" ADD COLUMN IF NOT EXISTS "defaultStoreId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SupplierCatalogProduct" ADD COLUMN IF NOT EXISTS "storeId" TEXT`);
  await prisma.$executeRawUnsafe(`UPDATE "SupplierProviderConfig" SET "defaultStoreId"=(SELECT "id" FROM "Store" WHERE "slug"='petita' LIMIT 1),"updatedAt"=NOW() WHERE "provider" IN ('CJ','ALIEXPRESS') AND "defaultStoreId" IS NULL`);
  await prisma.$executeRawUnsafe(`UPDATE "SupplierCatalogProduct" p SET "storeId"=c."defaultStoreId","updatedAt"=NOW() FROM "SupplierProviderConfig" c WHERE c."provider"=p."provider" AND p."storeId" IS NULL`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupplierCatalogProduct_provider_status_idx" ON "SupplierCatalogProduct"("provider","status")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SupplierCatalogProduct_category_status_idx" ON "SupplierCatalogProduct"("mappedCategoryId","status")`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SupplierSyncRun" (
      "id" TEXT PRIMARY KEY,
      "provider" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'RUNNING',
      "itemsSeen" INTEGER NOT NULL DEFAULT 0,
      "itemsChanged" INTEGER NOT NULL DEFAULT 0,
      "error" TEXT,
      "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "finishedAt" TIMESTAMPTZ
    )
  `);
}

async function providerMeta(provider:Provider){
  if(provider==="CJ"){
    const integration=await getRuntimeIntegration("cj-dropshipping");
    return{
    provider,
    label:"CJdropshipping",
    connected:Boolean(integration?.enabled&&integration.secrets.apiKey),
    catalogMode:"API",
    fulfillmentMode:"AUTOMATIC",
    capabilities:["catalog","stock","freight","order","tracking"],
    note:integration?.enabled&&integration.secrets.apiKey?"API prête à être testée.":"Ajoutez la clé API CJ depuis ce panneau pour activer l’API.",
  };}
  return{
    provider,
    label:"AliExpress",
    connected:Boolean(process.env.ALIEXPRESS_APP_KEY&&process.env.ALIEXPRESS_APP_SECRET),
    catalogMode:"MANUAL",
    fulfillmentMode:"MANUAL",
    capabilities:["catalog_manual","source_link"],
    note:"Le flux dropshipping historique AliExpress est déprécié : import/catalogue manuel au départ, sans commande automatique.",
  };
}

async function getCjAccessToken(){
  if(cjToken&&cjToken.expiresAt>Date.now()+60_000)return cjToken.accessToken;
  const integration=await getRuntimeIntegration("cj-dropshipping");
  const apiKey=(integration?.enabled?integration.secrets.apiKey:"")?.trim();
  if(!apiKey)throw new Error("cj_api_key_missing");
  const r=await fetch("https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({apiKey}),signal:AbortSignal.timeout(12_000),
  });
  const p=await r.json().catch(()=>({})) as any;
  if(!r.ok||p?.code!==200||!p?.data?.accessToken)throw new Error(p?.message||`cj_auth_${r.status}`);
  const expiryRaw=p.data.accessTokenExpiryDate;
  const expiry=expiryRaw?Date.parse(expiryRaw):Date.now()+179*24*60*60*1000;
  cjToken={accessToken:String(p.data.accessToken),refreshToken:p.data.refreshToken?String(p.data.refreshToken):undefined,expiresAt:Number.isFinite(expiry)?expiry:Date.now()+179*24*60*60*1000};
  return cjToken.accessToken;
}

const configSchema=z.object({
  enabled:z.boolean(),
  fulfillmentMode:z.enum(["AUTOMATIC","MANUAL"]),
  marginBps:z.number().int().min(0).max(20000),
  maxDeliveryDays:z.number().int().min(1).max(60),
  minRetailMarginMinor:z.number().int().min(0).max(100000),
  autoPublish:z.boolean().default(false),
});

const manualProductSchema=z.object({
  provider:z.enum(PROVIDERS),
  externalProductId:z.string().trim().min(1).max(200),
  externalVariantId:z.string().trim().max(200).optional().default(""),
  title:z.string().trim().min(3).max(240),
  description:z.string().trim().max(10000).optional(),
  sourceUrl:z.string().url().max(2000).optional(),
  primaryImageUrl:z.string().url().max(2000).optional(),
  sourcePriceMinor:z.number().int().min(0).optional(),
  sourceCurrency:z.string().trim().length(3).optional().default("EUR"),
  retailPriceMinor:z.number().int().min(0).optional(),
  mappedCategoryId:z.string().trim().max(100).optional(),
  warehouseCountryCode:z.string().trim().length(2).optional(),
  deliveryDaysMin:z.number().int().min(0).max(90).optional(),
  deliveryDaysMax:z.number().int().min(0).max(90).optional(),
});

export async function registerSupplierCatalogRoutes(app:FastifyInstance){
  const admin=requireAdminRoles(["SUPER_ADMIN","ADMIN","MARKETING","COMPLIANCE"]);

  app.get("/admin/suppliers/overview",{preHandler:admin},async()=>{
    const [configs,counts,recent]=await Promise.all([
      prisma.$queryRawUnsafe<any[]>(`SELECT c.*,s."name" AS "defaultStoreName",s."slug" AS "defaultStoreSlug" FROM "SupplierProviderConfig" c LEFT JOIN "Store" s ON s."id"=c."defaultStoreId" ORDER BY c."provider"`),
      prisma.$queryRawUnsafe<any[]>(`SELECT "provider","status",COUNT(*)::int AS "count" FROM "SupplierCatalogProduct" GROUP BY "provider","status" ORDER BY "provider","status"`),
      prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "SupplierSyncRun" ORDER BY "startedAt" DESC LIMIT 10`),
    ]);
    const providerRows=await Promise.all(PROVIDERS.map(async provider=>({...await providerMeta(provider),config:configs.find(x=>x.provider===provider)??null,counts:counts.filter(x=>x.provider===provider)})));
    return{providers:providerRows,recentSyncs:recent};
  });

  app.get("/admin/suppliers/products",{preHandler:admin},async(request)=>{
    const q=z.object({provider:z.enum(PROVIDERS).optional(),status:z.string().max(40).optional(),q:z.string().max(120).optional(),limit:z.coerce.number().int().min(1).max(200).default(100)}).safeParse(request.query);
    if(!q.success)return{items:[]};
    const where:string[]=[];const values:any[]=[];
    if(q.data.provider){values.push(q.data.provider);where.push(`p."provider"=$${values.length}`)}
    if(q.data.status){values.push(q.data.status);where.push(`p."status"=$${values.length}`)}
    if(q.data.q){values.push(`%${q.data.q}%`);where.push(`(p."title" ILIKE $${values.length} OR p."externalProductId" ILIKE $${values.length})`)}
    values.push(q.data.limit);
    return{items:await prisma.$queryRawUnsafe<any[]>(`SELECT p.*,c."name" AS "mappedCategoryName" FROM "SupplierCatalogProduct" p LEFT JOIN "Category" c ON c."id"=p."mappedCategoryId" ${where.length?`WHERE ${where.join(" AND ")}`:""} ORDER BY p."updatedAt" DESC LIMIT $${values.length}`,...values)};
  });

  app.put("/admin/suppliers/:provider/config",{preHandler:admin},async(request,reply)=>{
    const provider=z.enum(PROVIDERS).safeParse((request.params as any)?.provider);
    const body=configSchema.safeParse(request.body);
    if(!provider.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    if(provider.data==="ALIEXPRESS"&&body.data.fulfillmentMode==="AUTOMATIC")return reply.code(400).send({error:"aliexpress_automatic_fulfillment_disabled"});
    if(body.data.autoPublish)return reply.code(400).send({error:"supplier_auto_publish_disabled_for_pilot"});
    await prisma.$executeRawUnsafe(`UPDATE "SupplierProviderConfig" SET "enabled"=$2,"fulfillmentMode"=$3,"marginBps"=$4,"maxDeliveryDays"=$5,"minRetailMarginMinor"=$6,"autoPublish"=FALSE,"updatedAt"=NOW() WHERE "provider"=$1`,provider.data,body.data.enabled,body.data.fulfillmentMode,body.data.marginBps,body.data.maxDeliveryDays,body.data.minRetailMarginMinor);
    return{ok:true};
  });

  app.post("/admin/suppliers/manual-product",{preHandler:admin},async(request,reply)=>{
    const body=manualProductSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request",details:body.error.flatten()});
    const p=body.data;
    if(p.mappedCategoryId){const rows=await prisma.$queryRawUnsafe<any[]>(`SELECT "id" FROM "Category" WHERE "id"=$1 AND "isActive"=TRUE LIMIT 1`,p.mappedCategoryId);if(!rows.length)return reply.code(400).send({error:"invalid_category"})}
    const id=randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "SupplierCatalogProduct" ("id","provider","externalProductId","externalVariantId","title","description","sourceUrl","primaryImageUrl","sourcePriceMinor","sourceCurrency","retailPriceMinor","mappedCategoryId","storeId","warehouseCountryCode","deliveryDaysMin","deliveryDaysMax","fulfillmentMode","status","complianceStatus","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,(SELECT "defaultStoreId" FROM "SupplierProviderConfig" WHERE "provider"=$2 LIMIT 1),$13,$14,$15,$16,'DISCOVERED','PENDING',NOW()) ON CONFLICT ("provider","externalProductId","externalVariantId") DO UPDATE SET "title"=EXCLUDED."title","description"=EXCLUDED."description","sourceUrl"=EXCLUDED."sourceUrl","primaryImageUrl"=EXCLUDED."primaryImageUrl","sourcePriceMinor"=EXCLUDED."sourcePriceMinor","sourceCurrency"=EXCLUDED."sourceCurrency","retailPriceMinor"=EXCLUDED."retailPriceMinor","mappedCategoryId"=EXCLUDED."mappedCategoryId","storeId"=COALESCE(EXCLUDED."storeId","SupplierCatalogProduct"."storeId"),"warehouseCountryCode"=EXCLUDED."warehouseCountryCode","deliveryDaysMin"=EXCLUDED."deliveryDaysMin","deliveryDaysMax"=EXCLUDED."deliveryDaysMax","updatedAt"=NOW()`,id,p.provider,p.externalProductId,p.externalVariantId,p.title,p.description??null,p.sourceUrl??null,p.primaryImageUrl??null,p.sourcePriceMinor??null,p.sourceCurrency,p.retailPriceMinor??null,p.mappedCategoryId??null,p.warehouseCountryCode?.toUpperCase()??null,p.deliveryDaysMin??null,p.deliveryDaysMax??null,p.provider==="CJ"?"AUTOMATIC":"MANUAL");
    return{ok:true};
  });

  const fulfillmentAdmin=requireAdminRoles(["SUPER_ADMIN","ADMIN","FINANCE"]);

  app.get("/admin/suppliers/fulfillments",{preHandler:fulfillmentAdmin},async(request)=>{
    const q=z.object({limit:z.coerce.number().int().min(1).max(200).default(100)}).safeParse(request.query);
    const limit=q.success?q.data.limit:100;
    const items=await prisma.$queryRawUnsafe<any[]>(`SELECT f."marketplaceOrderId",f."providerOrderId",f."providerShipmentOrderId",f."providerStatus",f."logisticName",f."trackingNumber",f."state",f."attemptCount",f."lastError",f."totalCostMinor",f."costCurrency",f."createdAt",f."updatedAt",o."orderNumber",o."itemAmountMinor",o."totalAmountMinor",o."currency",o."status"::text AS "marketplaceStatus",l."title" AS "listingTitle" FROM "SupplierFulfillmentOrder" f JOIN "MarketplaceOrder" o ON o."id"=f."marketplaceOrderId" JOIN "Listing" l ON l."id"=o."listingId" ORDER BY f."updatedAt" DESC LIMIT $1`,limit);
    return{items};
  });

  app.post("/admin/suppliers/fulfillments/:orderId/pay",{preHandler:fulfillmentAdmin},async(request,reply)=>{
    const p=z.object({orderId:z.string().min(1)}).safeParse(request.params);
    if(!p.success)return reply.code(400).send({error:"invalid_request"});
    try{return await paySupplierFulfillment(p.data.orderId)}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"supplier_payment_failed"})}
  });

  app.post("/admin/suppliers/fulfillments/:orderId/sync",{preHandler:fulfillmentAdmin},async(request,reply)=>{
    const p=z.object({orderId:z.string().min(1)}).safeParse(request.params);
    if(!p.success)return reply.code(400).send({error:"invalid_request"});
    try{return await syncSupplierFulfillment(p.data.orderId)}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"supplier_sync_failed"})}
  });

  app.get("/admin/suppliers/cj/balance",{preHandler:fulfillmentAdmin},async(_request,reply)=>{
    try{const token=await getCjAccessToken();const r=await fetch("https://developers.cjdropshipping.com/api2.0/v1/shopping/pay/getBalance",{headers:{"CJ-Access-Token":token},signal:AbortSignal.timeout(12_000)});const p=await r.json().catch(()=>({})) as any;if(!r.ok||p?.code!==200)return reply.code(502).send({error:"cj_balance_failed",message:p?.message??`HTTP ${r.status}`});return{ok:true,amount:Number(p?.data?.amount??0),currency:"USD"};}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"cj_balance_failed"})}
  });

  app.post("/admin/suppliers/cj/test",{preHandler:admin},async(_request,reply)=>{
    try{const token=await getCjAccessToken();const r=await fetch("https://developers.cjdropshipping.com/api2.0/v1/product/getCategory",{headers:{"CJ-Access-Token":token},signal:AbortSignal.timeout(12_000)});const p=await r.json().catch(()=>({})) as any;if(!r.ok||p?.code!==200)return reply.code(502).send({error:"cj_test_failed",message:p?.message??`HTTP ${r.status}`});return{ok:true,categories:Array.isArray(p?.data)?p.data.length:null};}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:"cj_test_failed"})}
  });
}
