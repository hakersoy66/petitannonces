import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";
import { createPresignedUpload, makeStoredObjectPublic, publicObjectUrl, storageConfigured, uploadStoredObject, verifyStoredObject } from "./storage.js";

const ROLES=["SUPER_ADMIN","ADMIN","MARKETING","FINANCE"] as const;
const BANNER_MIMES=new Set(["image/jpeg","image/png","image/webp","image/avif"]);
const MAX_BANNER_BYTES=8*1024*1024;
const placementSchema=z.enum(["HOME_TOP","HOME_AFTER_LATEST"]);
const bannerSchema=z.object({
  id:z.string().min(3).max(80),placement:placementSchema,title:z.string().trim().min(2).max(120),body:z.string().trim().max(320).default(""),
  ctaLabel:z.string().trim().max(50).default("Découvrir"),href:z.string().trim().max(500).default("/recherche"),imageUrl:z.string().url().nullable().default(null),
  enabled:z.boolean().default(true),startsAt:z.string().datetime().nullable().default(null),endsAt:z.string().datetime().nullable().default(null),sortOrder:z.number().int().min(0).max(9999).default(100),
});
const bannersSchema=z.array(bannerSchema).max(30);
const promoTypeSchema=z.enum(["URGENT","FEATURED","BUMP","SPONSORED","GALLERY"]);
const promoUpdateSchema=z.object({name:z.string().trim().min(2).max(100),description:z.string().trim().max(500).nullable(),priceMinor:z.number().int().min(0).max(1_000_000),durationHours:z.number().int().min(1).max(24*365).nullable(),isActive:z.boolean()});
const promoCreateSchema=promoUpdateSchema.extend({code:z.string().trim().min(2).max(60).regex(/^[A-Z0-9_-]+$/),type:promoTypeSchema});
const planUpdateSchema=z.object({
  name:z.string().trim().min(2).max(100),description:z.string().trim().max(500).nullable(),monthlyPriceMinor:z.number().int().min(0).max(5_000_000),yearlyPriceMinor:z.number().int().min(0).max(50_000_000).nullable(),
  maxActiveListings:z.number().int().positive().max(1_000_000).nullable(),maxStores:z.number().int().min(1).max(1000),analyticsEnabled:z.boolean(),autoRenewListings:z.boolean(),prioritySupport:z.boolean(),featuredCreditsMonthly:z.number().int().min(0).max(100000).optional(),bulkImportEnabled:z.boolean(),apiFeedEnabled:z.boolean(),isActive:z.boolean(),
});
const DEFAULT_PLANS=[
  {code:"ESSENTIEL" as const,name:"Essentiel",description:"Pour démarrer avec une présence professionnelle simple.",monthlyPriceMinor:990,maxActiveListings:50,maxStores:1,analyticsEnabled:false,autoRenewListings:false,prioritySupport:false,featuredCreditsMonthly:0,bulkImportEnabled:false,apiFeedEnabled:false,isActive:true},
  {code:"PROFESSIONNEL" as const,name:"Professionnel",description:"Pour les vendeurs réguliers qui veulent plus d’outils et de visibilité.",monthlyPriceMinor:2490,maxActiveListings:250,maxStores:2,analyticsEnabled:true,autoRenewListings:true,prioritySupport:false,featuredCreditsMonthly:0,bulkImportEnabled:true,apiFeedEnabled:true,isActive:true},
  {code:"PREMIUM" as const,name:"Premium",description:"Pour les activités à fort volume avec outils avancés et support prioritaire.",monthlyPriceMinor:4990,maxActiveListings:null,maxStores:5,analyticsEnabled:true,autoRenewListings:true,prioritySupport:true,featuredCreditsMonthly:0,bulkImportEnabled:true,apiFeedEnabled:true,isActive:true},
];

function safeHref(value:string){return value.startsWith("/")||/^https:\/\//i.test(value)}
function ext(mime:string){if(mime==="image/jpeg")return"jpg";if(mime==="image/png")return"png";if(mime==="image/avif")return"avif";return"webp"}
function tokenHash(token:string){return createHash("sha256").update(token).digest("hex")}
async function actorId(request:any){const token=request.cookies?.pa_session;if(!token)return null;const row=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},select:{userId:true,revokedAt:true,expiresAt:true}});return row&&!row.revokedAt&&row.expiresAt>new Date()?row.userId:null}
async function audit(request:any,action:string,entityType:string,entityId:string,metadata?:unknown){const actor=await actorId(request);if(!actor)return;await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,randomUUID(),actor,action,entityType,entityId,metadata?JSON.stringify(metadata):null)}
async function ensurePlans(){await Promise.all(DEFAULT_PLANS.map(plan=>prisma.professionalPlan.upsert({where:{code:plan.code},create:plan,update:{}})))}
async function loadBanners(){const rows=await prisma.$queryRawUnsafe<Array<{value:unknown}>>(`SELECT "value" FROM "AdminSetting" WHERE "key"='marketing.banners' LIMIT 1`);const parsed=bannersSchema.safeParse(rows[0]?.value??[]);return parsed.success?parsed.data:[]}
async function saveBanners(value:z.infer<typeof bannersSchema>,request:any){const actor=await actorId(request);await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedByUserId","updatedAt") VALUES ('marketing.banners',$1::jsonb,$2,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=CURRENT_TIMESTAMP`,JSON.stringify(value),actor)}

export async function registerAdminCommercialRoutes(app:FastifyInstance){
  app.get("/public/banners",async(request,reply)=>{const q=z.object({placement:placementSchema}).safeParse(request.query);if(!q.success)return reply.code(400).send({error:"invalid_placement"});const now=Date.now();const banners=(await loadBanners()).filter(b=>b.enabled&&b.placement===q.data.placement&&(!b.startsAt||new Date(b.startsAt).getTime()<=now)&&(!b.endsAt||new Date(b.endsAt).getTime()>now)).sort((a,b)=>a.sortOrder-b.sortOrder);return reply.send({banners})});

  app.get("/admin/commercial",{preHandler:requireAdminRoles([...ROLES])},async(_request,reply)=>{await ensurePlans();const [promotions,plans,banners]=await Promise.all([
    prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","code","type","name","description","priceMinor","currency","durationHours","isActive","updatedAt" FROM "PromotionProduct" ORDER BY "priceMinor" ASC`),
    prisma.professionalPlan.findMany({orderBy:{monthlyPriceMinor:"asc"}}),loadBanners(),
  ]);return reply.send({promotions,plans,banners})});

  app.post("/admin/commercial/promotions",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{
    const body=promoCreateSchema.safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_request",details:body.error.flatten()});
    const id=randomUUID();
    try{
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PromotionProduct" ("id","code","type","name","description","priceMinor","currency","durationHours","creditCost","isActive","createdAt","updatedAt")
         VALUES ($1,$2,$3::"PromotionType",$4,$5,$6,'EUR',$7,0,$8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        id,body.data.code,body.data.type,body.data.name,body.data.description,body.data.priceMinor,body.data.durationHours,body.data.isActive,
      );
    }catch(error:any){
      if(String(error?.message??"").includes("unique"))return reply.code(409).send({error:"promotion_code_exists"});
      throw error;
    }
    await audit(request,"PROMOTION_PRODUCT_CREATED","PROMOTION_PRODUCT",id,body.data);
    return reply.code(201).send({created:true,id});
  });

  app.put("/admin/commercial/promotions/:id",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=promoUpdateSchema.safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`UPDATE "PromotionProduct" SET "name"=$1,"description"=$2,"priceMinor"=$3,"creditCost"=0,"durationHours"=$4,"isActive"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$6 RETURNING "id"`,body.data.name,body.data.description,body.data.priceMinor,body.data.durationHours,body.data.isActive,params.data.id);if(!rows[0])return reply.code(404).send({error:"promotion_not_found"});await audit(request,"PROMOTION_PRODUCT_UPDATED","PROMOTION_PRODUCT",params.data.id,body.data);return reply.send({saved:true})});

  app.put("/admin/commercial/pro-plans/:id",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=planUpdateSchema.safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const plan=await prisma.professionalPlan.findUnique({where:{id:params.data.id}});if(!plan)return reply.code(404).send({error:"plan_not_found"});const updated=await prisma.professionalPlan.update({where:{id:plan.id},data:{...body.data,featuredCreditsMonthly:0}});await audit(request,"PRO_PLAN_UPDATED","PRO_PLAN",plan.id,{code:plan.code,...body.data});return reply.send({saved:true,plan:updated})});

  app.put("/admin/commercial/banners",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{const parsed=bannersSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_banners",details:parsed.error.flatten()});if(parsed.data.some(b=>!safeHref(b.href)))return reply.code(400).send({error:"invalid_banner_href"});if(new Set(parsed.data.map(b=>b.id)).size!==parsed.data.length)return reply.code(400).send({error:"duplicate_banner_id"});if(parsed.data.some(b=>b.startsAt&&b.endsAt&&new Date(b.endsAt)<=new Date(b.startsAt)))return reply.code(400).send({error:"invalid_banner_period"});await saveBanners(parsed.data,request);await audit(request,"BANNERS_UPDATED","MARKETING","marketing.banners",{count:parsed.data.length});return reply.send({saved:true,banners:parsed.data})});

  app.post("/admin/commercial/banners/upload-intent",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{if(!storageConfigured())return reply.code(503).send({error:"object_storage_not_configured"});const b=z.object({mimeType:z.string(),sizeBytes:z.number().int().positive()}).safeParse(request.body);if(!b.success)return reply.code(400).send({error:"invalid_request"});if(!BANNER_MIMES.has(b.data.mimeType))return reply.code(415).send({error:"unsupported_media_type"});if(b.data.sizeBytes>MAX_BANNER_BYTES)return reply.code(413).send({error:"media_too_large",maxBytes:MAX_BANNER_BYTES});const objectKey=`site/banners/${randomUUID()}.${ext(b.data.mimeType)}`;return reply.code(201).send({objectKey,uploadUrl:await createPresignedUpload(objectKey,b.data.mimeType),method:"PUT",headers:{"content-type":b.data.mimeType},expiresInSeconds:600})});

  app.post("/admin/commercial/banners/upload-direct",{preHandler:requireAdminRoles([...ROLES]),bodyLimit:MAX_BANNER_BYTES},async(request,reply)=>{if(!storageConfigured())return reply.code(503).send({error:"object_storage_not_configured"});const mime=String(request.headers["content-type"]??"").split(";")[0]?.trim().toLowerCase();if(!mime||!BANNER_MIMES.has(mime))return reply.code(415).send({error:"unsupported_media_type"});const body=request.body;if(!Buffer.isBuffer(body)||body.length<1)return reply.code(400).send({error:"empty_media"});if(body.length>MAX_BANNER_BYTES)return reply.code(413).send({error:"media_too_large",maxBytes:MAX_BANNER_BYTES});const objectKey=`site/banners/${randomUUID()}.${ext(mime)}`;const url=await uploadStoredObject(objectKey,mime,body);await audit(request,"BANNER_ASSET_UPDATED","MARKETING",objectKey,{url,directUpload:true});return reply.send({url})});

  app.post("/admin/commercial/banners/upload-confirm",{preHandler:requireAdminRoles([...ROLES])},async(request,reply)=>{const b=z.object({objectKey:z.string().min(10).max(500)}).safeParse(request.body);if(!b.success||!b.data.objectKey.startsWith("site/banners/"))return reply.code(400).send({error:"invalid_request"});const stored=await verifyStoredObject(b.data.objectKey);if(!stored.sizeBytes||stored.sizeBytes>MAX_BANNER_BYTES||!stored.mimeType||!BANNER_MIMES.has(stored.mimeType))return reply.code(422).send({error:"stored_media_mismatch"});await makeStoredObjectPublic(b.data.objectKey);return reply.send({url:publicObjectUrl(b.data.objectKey)})});
}
