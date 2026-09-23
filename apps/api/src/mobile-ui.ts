import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdminRoles } from "./rbac.js";

const DRAFT_KEY = "mobile.ui.draft";
const PUBLISHED_KEY = "mobile.ui.published";
const HISTORY_KEY = "mobile.ui.history";
const SCHEDULED_KEY = "mobile.ui.scheduled";
const MAX_HISTORY = 25;

const platformEnum = z.enum(["ANDROID", "IOS", "PWA"]);
const blockIdEnum = z.enum(["search", "categories", "latest", "map", "discover", "pro_banner", "more", "vacation"]);
const navIdEnum = z.enum(["home", "search", "sell", "messages", "account"]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const blockSchema = z.object({
 id: blockIdEnum,
 enabled: z.boolean().default(true),
 order: z.number().int().min(0).max(999),
 title: z.string().max(80).default(""),
 subtitle: z.string().max(180).default(""),
 itemLimit: z.number().int().min(1).max(24).default(6),
 variant: z.enum(["DEFAULT", "COMPACT", "WIDE"]).default("DEFAULT"),
 audience: z.enum(["ALL", "GUEST", "AUTH", "PRO"]).default("ALL"),
});

const navItemSchema = z.object({
 id: navIdEnum,
 label: z.string().trim().min(1).max(24),
 enabled: z.boolean().default(true),
 order: z.number().int().min(0).max(20),
});

const platformSchema = z.object({
 header: z.object({
 enabled: z.boolean().default(true),
 showLogo: z.boolean().default(true),
 showPostButton: z.boolean().default(true),
 showNotifications: z.boolean().default(true),
 showAccount: z.boolean().default(true),
 }),
 blocks: z.array(blockSchema).min(1).max(20),
 bottomNav: z.object({
 enabled: z.boolean().default(true),
 items: z.array(navItemSchema).min(1).max(8),
 }),
 theme: z.object({
 primary: hex.default("#5b4cf0"),
 background: hex.default("#f7f7fb"),
 cardRadius: z.number().int().min(8).max(32).default(18),
 density: z.enum(["COMPACT", "COMFORTABLE"]).default("COMFORTABLE"),
 }),
 abTest: z.object({
 enabled: z.boolean().default(false),
 percentB: z.number().int().min(1).max(99).default(50),
 variantBOrder: z.array(blockIdEnum).max(20).default([]),
 }),
}).superRefine((value, ctx) => {
 const ids=value.blocks.map(b=>b.id);
 if(new Set(ids).size!==ids.length)ctx.addIssue({code:"custom",message:"duplicate_block"});
 const nav=value.bottomNav.items.map(i=>i.id);
 if(new Set(nav).size!==nav.length)ctx.addIssue({code:"custom",message:"duplicate_nav_item"});
});

const configSchema = z.object({
 schemaVersion: z.literal(1),
 platforms: z.object({ ANDROID: platformSchema, IOS: platformSchema, PWA: platformSchema }),
});

type MobileUiConfig = z.infer<typeof configSchema>;
type PlatformConfig = z.infer<typeof platformSchema>;
type Platform = z.infer<typeof platformEnum>;
type HistoryItem = { revision:number; publishedAt:string; actorUserId:string|null; note:string|null; config:MobileUiConfig };
type ScheduledItem = { publishAt:string; scheduledAt:string; actorUserId:string|null; note:string|null; config:MobileUiConfig };

type DefaultBlock = z.infer<typeof blockSchema>;
const blocks:DefaultBlock[]=[
 {id:"search",enabled:true,order:10,title:"Rechercher",subtitle:"",itemLimit:1,variant:"DEFAULT",audience:"ALL"},
 {id:"categories",enabled:true,order:20,title:"Catégories",subtitle:"",itemLimit:10,variant:"DEFAULT",audience:"ALL"},
 {id:"latest",enabled:true,order:30,title:"Dernières annonces",subtitle:"",itemLimit:6,variant:"DEFAULT",audience:"ALL"},
 {id:"map",enabled:true,order:40,title:"Explorez les annonces par ville",subtitle:"Touchez une ville pour découvrir les annonces locales.",itemLimit:10,variant:"DEFAULT",audience:"ALL"},
 {id:"discover",enabled:true,order:50,title:"À découvrir",subtitle:"",itemLimit:4,variant:"DEFAULT",audience:"ALL"},
 {id:"pro_banner",enabled:true,order:60,title:"Vous êtes professionnel ?",subtitle:"Ouvrez votre boutique gratuitement",itemLimit:1,variant:"DEFAULT",audience:"ALL"},
 {id:"more",enabled:true,order:70,title:"Plus d’annonces",subtitle:"",itemLimit:6,variant:"DEFAULT",audience:"ALL"},
 {id:"vacation",enabled:true,order:80,title:"Vacances Petit Annonces",subtitle:"Partez moins cher, profitez plus.",itemLimit:4,variant:"DEFAULT",audience:"ALL"},
];
const navItems=[
 {id:"home" as const,label:"Accueil",enabled:true,order:10},
 {id:"search" as const,label:"Rechercher",enabled:true,order:20},
 {id:"sell" as const,label:"Déposer",enabled:true,order:30},
 {id:"messages" as const,label:"Messages",enabled:true,order:40},
 {id:"account" as const,label:"Compte",enabled:true,order:50},
];
function defaultPlatform():PlatformConfig{return {header:{enabled:true,showLogo:true,showPostButton:true,showNotifications:true,showAccount:true},blocks:blocks.map(v=>({...v})),bottomNav:{enabled:true,items:navItems.map(v=>({...v}))},theme:{primary:"#5b4cf0",background:"#f7f7fb",cardRadius:18,density:"COMFORTABLE"},abTest:{enabled:false,percentB:50,variantBOrder:[]}}}
const DEFAULT_CONFIG:MobileUiConfig={schemaVersion:1,platforms:{ANDROID:defaultPlatform(),IOS:defaultPlatform(),PWA:defaultPlatform()}};

async function actorId(request:FastifyRequest){
 const token=request.cookies.pa_session;
 if(!token)return null;
 const tokenHash=createHash("sha256").update(token).digest("hex");
 const session=await prisma.session.findUnique({where:{tokenHash},select:{userId:true,revokedAt:true,expiresAt:true}});
 if(!session||session.revokedAt||session.expiresAt<=new Date())return null;
 return session.userId;
}
async function audit(request:FastifyRequest,action:string,entityId:string,metadata:Record<string,unknown>={}){
 const actor=await actorId(request);if(!actor)return;
 await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,'MOBILE_UI',$4,$5::jsonb)`,randomUUID(),actor,action,entityId,JSON.stringify(metadata)).catch(()=>undefined);
}
async function setting<T>(key:string):Promise<T|null>{
 const rows=await prisma.$queryRawUnsafe<Array<{value:unknown}>>(`SELECT "value" FROM "AdminSetting" WHERE "key"=$1 LIMIT 1`,key);
 return (rows[0]?.value??null) as T|null;
}
async function putSetting(key:string,value:unknown,updatedByUserId:string|null){
 await prisma.$executeRawUnsafe(`INSERT INTO "AdminSetting" ("key","value","updatedByUserId","updatedAt") VALUES ($1,$2::jsonb,$3,CURRENT_TIMESTAMP) ON CONFLICT ("key") DO UPDATE SET "value"=EXCLUDED."value","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=CURRENT_TIMESTAMP`,key,JSON.stringify(value),updatedByUserId);
}
async function deleteSetting(key:string){await prisma.$executeRawUnsafe(`DELETE FROM "AdminSetting" WHERE "key"=$1`,key)}
async function loadConfig(key:string){const raw=await setting<unknown>(key);const parsed=configSchema.safeParse(raw);return parsed.success?parsed.data:null}
async function loadHistory(){const raw=await setting<unknown>(HISTORY_KEY);if(!Array.isArray(raw))return [] as HistoryItem[];return raw.filter(Boolean) as HistoryItem[]}
async function loadScheduled(){const raw=await setting<unknown>(SCHEDULED_KEY);if(!raw||typeof raw!=="object")return null;const item=raw as ScheduledItem;const parsed=configSchema.safeParse(item.config);if(!parsed.success||!item.publishAt)return null;return {...item,config:parsed.data}}
async function effectivePublished(){
 const published=(await loadConfig(PUBLISHED_KEY))??DEFAULT_CONFIG;
 const scheduled=await loadScheduled();
 if(scheduled&&new Date(scheduled.publishAt).getTime()<=Date.now())return {config:scheduled.config,source:"scheduled" as const,publishAt:scheduled.publishAt};
 return {config:published,source:"published" as const,publishAt:null};
}
function nextRevision(history:HistoryItem[]){return history.reduce((m,v)=>Math.max(m,Number(v.revision)||0),0)+1}
async function publishConfig(request:FastifyRequest,config:MobileUiConfig,note:string|null){
 const actor=await actorId(request);const history=await loadHistory();const revision=nextRevision(history);const publishedAt=new Date().toISOString();
 const item:HistoryItem={revision,publishedAt,actorUserId:actor,note,config};
 await putSetting(PUBLISHED_KEY,config,actor);
 await putSetting(DRAFT_KEY,config,actor);
 await putSetting(HISTORY_KEY,[item,...history].slice(0,MAX_HISTORY),actor);
 await deleteSetting(SCHEDULED_KEY);
 return item;
}

export async function registerMobileUiRoutes(app:FastifyInstance){
 app.get("/mobile/ui-config",async(request,reply)=>{
 const parsed=platformEnum.safeParse((request.query as {platform?:unknown})?.platform??"ANDROID");
 const platform:Platform=parsed.success?parsed.data:"ANDROID";
 const effective=await effectivePublished();
 const history=await loadHistory();
 const revision=history.find(h=>JSON.stringify(h.config)===JSON.stringify(effective.config))?.revision??history[0]?.revision??0;
 reply.header("cache-control","public, max-age=30, stale-while-revalidate=300");
 return reply.send({schemaVersion:1,revision,source:effective.source,publishAt:effective.publishAt,platform,config:effective.config.platforms[platform]});
 });

 const guard=requireAdminRoles(["SUPER_ADMIN"]);
 app.get("/admin/mobile-ui",{preHandler:guard},async(_request,reply)=>{
 const [draft,published,history,scheduled,effective]=await Promise.all([loadConfig(DRAFT_KEY),loadConfig(PUBLISHED_KEY),loadHistory(),loadScheduled(),effectivePublished()]);
 return reply.send({draft:draft??published??DEFAULT_CONFIG,published:published??DEFAULT_CONFIG,effective:effective.config,history:history.map(({config,...meta})=>meta),scheduled:scheduled?{publishAt:scheduled.publishAt,scheduledAt:scheduled.scheduledAt,note:scheduled.note}:null});
 });

 app.put("/admin/mobile-ui/draft",{preHandler:guard},async(request,reply)=>{
 const parsed=configSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_mobile_ui_config",issues:parsed.error.issues.slice(0,12)});
 const actor=await actorId(request);await putSetting(DRAFT_KEY,parsed.data,actor);await audit(request,"MOBILE_UI_DRAFT_SAVED","draft",{});return reply.send({saved:true,draft:parsed.data});
 });

 app.post("/admin/mobile-ui/publish",{preHandler:guard},async(request,reply)=>{
 const body=(request.body??{}) as {note?:unknown};const draft=(await loadConfig(DRAFT_KEY))??(await loadConfig(PUBLISHED_KEY))??DEFAULT_CONFIG;
 const note=typeof body.note==="string"?body.note.slice(0,240):null;const item=await publishConfig(request,draft,note);await audit(request,"MOBILE_UI_PUBLISHED",String(item.revision),{note});return reply.send({published:true,revision:item.revision,publishedAt:item.publishedAt});
 });

 app.post("/admin/mobile-ui/schedule",{preHandler:guard},async(request,reply)=>{
 const parsed=z.object({publishAt:z.string().datetime(),note:z.string().max(240).optional()}).safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_schedule"});
 const when=new Date(parsed.data.publishAt);if(when.getTime()<=Date.now()+60_000)return reply.code(400).send({error:"schedule_must_be_future"});
 const draft=(await loadConfig(DRAFT_KEY))??(await loadConfig(PUBLISHED_KEY))??DEFAULT_CONFIG;const actor=await actorId(request);const scheduled:ScheduledItem={publishAt:when.toISOString(),scheduledAt:new Date().toISOString(),actorUserId:actor,note:parsed.data.note??null,config:draft};await putSetting(SCHEDULED_KEY,scheduled,actor);await audit(request,"MOBILE_UI_SCHEDULED",scheduled.publishAt,{note:scheduled.note});return reply.send({scheduled:true,publishAt:scheduled.publishAt});
 });

 app.delete("/admin/mobile-ui/schedule",{preHandler:guard},async(request,reply)=>{await deleteSetting(SCHEDULED_KEY);await audit(request,"MOBILE_UI_SCHEDULE_CANCELED","scheduled",{});return reply.send({canceled:true})});

 app.post("/admin/mobile-ui/rollback/:revision",{preHandler:guard},async(request,reply)=>{
 const revision=Number((request.params as {revision?:string}).revision);const history=await loadHistory();const target=history.find(h=>h.revision===revision);if(!target)return reply.code(404).send({error:"revision_not_found"});
 const item=await publishConfig(request,target.config,`Rollback vers v${revision}`);await audit(request,"MOBILE_UI_ROLLBACK",String(item.revision),{fromRevision:revision});return reply.send({rolledBack:true,revision:item.revision,publishedAt:item.publishedAt});
 });
}
