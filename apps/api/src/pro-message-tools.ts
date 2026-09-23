import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProfessionalContext, getProfessionalSector, type ProfessionalSector } from "./pro-suite.js";
import { deliverUserEvent } from "./notification-delivery.js";

const DEFAULT_AWAY="Merci pour votre message. Nous sommes actuellement en dehors de nos horaires d’ouverture. Votre demande a bien été reçue et nous vous répondrons dès notre retour.";
const DEFAULT_DAYS=[1,2,3,4,5];
let schemaPromise:Promise<void>|null=null;

export function ensureProMessageToolsSchema(){
 if(schemaPromise)return schemaPromise;
 schemaPromise=(async()=>{
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProMessagingSettings" (
   "ownerUserId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
   "awayEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
   "awayMessage" TEXT NOT NULL DEFAULT '${DEFAULT_AWAY.replace(/'/g,"''")}',
   "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
   "businessStart" TEXT NOT NULL DEFAULT '09:00',
   "businessEnd" TEXT NOT NULL DEFAULT '18:00',
   "workingDays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
   "cooldownHours" INTEGER NOT NULL DEFAULT 12,
   "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
   "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProQuickReply" (
   "id" TEXT PRIMARY KEY,"ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
   "label" TEXT NOT NULL,"body" TEXT NOT NULL,"sortOrder" INTEGER NOT NULL DEFAULT 0,"active" BOOLEAN NOT NULL DEFAULT TRUE,
   "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProQuickReply_owner_sort_idx" ON "ProQuickReply"("ownerUserId","active","sortOrder")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ProAutoReplyLog" (
   "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
   "ownerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
   "repliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
   PRIMARY KEY ("conversationId","ownerUserId")
  )`);
 })().catch(error=>{schemaPromise=null;throw error});
 return schemaPromise;
}

function defaultsForSector(sector:ProfessionalSector){
 if(sector==="IMMOBILIER")return[
  ["Disponibilité","Bonjour, merci pour votre message. Le bien est toujours disponible. Souhaitez-vous organiser une visite ?"],
  ["Visite","Avec plaisir. Indiquez-moi vos disponibilités et nous pouvons convenir d’un créneau de visite."],
  ["Dossier","Merci pour votre intérêt. Je peux vous préciser les documents et informations nécessaires selon votre projet."],
 ];
 if(sector==="AUTOMOBILE")return[
  ["Disponible","Bonjour, merci pour votre message. Le véhicule est toujours disponible."],
  ["Essai","Nous pouvons organiser un essai du véhicule. Indiquez-moi le créneau qui vous conviendrait."],
  ["Historique","Je peux vous transmettre les informations disponibles sur l’entretien et l’historique du véhicule."],
 ];
 if(sector==="COMMERCE")return[
  ["En stock","Bonjour, merci pour votre message. Le produit est actuellement disponible."],
  ["Livraison","Nous pouvons vous préciser les options de livraison ou de remise disponibles pour cet article."],
  ["Détails produit","Avec plaisir. Dites-moi quelle information complémentaire vous souhaitez sur le produit."],
 ];
 if(sector==="VACANCES")return[
  ["Disponibilités","Bonjour, merci pour votre message. Consultez les dates souhaitées et je vous confirme la disponibilité du séjour."],
  ["Arrivée","Je peux vous préciser les horaires d’arrivée et de départ ainsi que les modalités d’accès."],
  ["Équipements","Avec plaisir. Dites-moi quel équipement ou service vous souhaitez vérifier avant de réserver."],
 ];
 if(sector==="SERVICES")return[
  ["Votre besoin","Bonjour, merci pour votre message. Pouvez-vous me préciser votre besoin afin que je vous réponde au mieux ?"],
  ["Devis","Je peux vous préparer une estimation. Indiquez-moi les principales informations concernant votre demande."],
  ["Disponibilité","Merci pour votre demande. Je vous confirme mes prochaines disponibilités dès que possible."],
 ];
 return[
  ["Disponible","Bonjour, merci pour votre message. L’annonce est toujours disponible."],
  ["Informations","Avec plaisir. Dites-moi quelle information complémentaire vous souhaitez."],
  ["Livraison","Je peux vous préciser les modalités de remise ou de livraison disponibles."],
 ];
}

async function ensureDefaults(ownerUserId:string,sector:ProfessionalSector){
 await ensureProMessageToolsSchema();
 await prisma.$executeRawUnsafe(`INSERT INTO "ProMessagingSettings" ("ownerUserId") VALUES ($1) ON CONFLICT ("ownerUserId") DO NOTHING`,ownerUserId);
 const rows=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "ProQuickReply" WHERE "ownerUserId"=$1`,ownerUserId);
 if(Number(rows[0]?.count??0n)>0)return;
 let sort=0;for(const [label,body] of defaultsForSector(sector))await prisma.$executeRawUnsafe(`INSERT INTO "ProQuickReply" ("id","ownerUserId","label","body","sortOrder") VALUES ($1,$2,$3,$4,$5)`,randomUUID(),ownerUserId,label,body,sort++);
}

function parseDays(value:unknown){if(Array.isArray(value))return value.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6);return DEFAULT_DAYS}
function localClock(timezone:string,date=new Date()){
 const fmt=new Intl.DateTimeFormat("en-US",{timeZone:timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 const parts=Object.fromEntries(fmt.formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
 const dayMap:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
 return{day:dayMap[parts.weekday??""]??-1,minutes:Number(parts.hour??0)*60+Number(parts.minute??0)};
}
function hhmmMinutes(value:string){const [h,m]=value.split(":").map(Number);return (h||0)*60+(m||0)}

export async function maybeSendProfessionalAwayReply(input:{conversationId:string;senderId:string;sellerId:string;listingId:string}){
 if(input.senderId===input.sellerId)return null;
 await ensureProMessageToolsSchema();
 const seller=await prisma.user.findUnique({where:{id:input.sellerId},select:{kind:true,status:true}});if(seller?.kind!=="PROFESSIONNEL"||seller.status!=="ACTIVE")return null;
 const sector=await getProfessionalSector(input.sellerId);await ensureDefaults(input.sellerId,sector);
 const rows=await prisma.$queryRawUnsafe<Array<{awayEnabled:boolean;awayMessage:string;timezone:string;businessStart:string;businessEnd:string;workingDays:unknown;cooldownHours:number}>>(`SELECT "awayEnabled","awayMessage","timezone","businessStart","businessEnd","workingDays","cooldownHours" FROM "ProMessagingSettings" WHERE "ownerUserId"=$1 LIMIT 1`,input.sellerId);const settings=rows[0];if(!settings?.awayEnabled)return null;
 const local=localClock(settings.timezone||"Europe/Paris");const days=parseDays(settings.workingDays);const start=hhmmMinutes(settings.businessStart),end=hhmmMinutes(settings.businessEnd);const inHours=days.includes(local.day)&&local.minutes>=start&&local.minutes<end;if(inHours)return null;
 const cooldown=Math.max(1,Math.min(72,Number(settings.cooldownHours)||12));
 const recent=await prisma.$queryRawUnsafe<Array<{repliedAt:Date}>>(`SELECT "repliedAt" FROM "ProAutoReplyLog" WHERE "conversationId"=$1 AND "ownerUserId"=$2 AND "repliedAt">CURRENT_TIMESTAMP-($3::text||' hours')::interval LIMIT 1`,input.conversationId,input.sellerId,String(cooldown));if(recent[0])return null;
 const listing=await prisma.listing.findUnique({where:{id:input.listingId},select:{title:true}});const body=(settings.awayMessage||DEFAULT_AWAY).replaceAll("{annonce}",listing?.title??"votre demande").slice(0,1000);
 const message=await prisma.message.create({data:{conversationId:input.conversationId,senderId:input.sellerId,kind:"TEXT",body}});await prisma.conversation.update({where:{id:input.conversationId},data:{lastMessageAt:message.createdAt}});
 await prisma.$executeRawUnsafe(`INSERT INTO "ProAutoReplyLog" ("conversationId","ownerUserId","repliedAt") VALUES ($1,$2,CURRENT_TIMESTAMP) ON CONFLICT ("conversationId","ownerUserId") DO UPDATE SET "repliedAt"=CURRENT_TIMESTAMP`,input.conversationId,input.sellerId);
 await deliverUserEvent({userId:input.senderId,eventKind:"MESSAGE",title:"Réponse automatique du professionnel",body:body.slice(0,180),actionUrl:`/messages?conversation=${input.conversationId}&message=${message.id}`,metadata:{conversationId:input.conversationId,listingId:input.listingId,messageId:message.id,automatic:true}}).catch(()=>undefined);
 return message;
}

export async function registerProMessageToolRoutes(app:FastifyInstance){
 await ensureProMessageToolsSchema();
 app.get("/pro/message-tools",async(request,reply)=>{const auth=await requireProfessionalContext(request,reply,"DASHBOARD");if(!auth)return;const{ctx}=auth;await ensureDefaults(ctx.ownerUserId,ctx.sector);const [settings,replies]=await Promise.all([
  prisma.$queryRawUnsafe<Array<any>>(`SELECT "awayEnabled","awayMessage","timezone","businessStart","businessEnd","workingDays","cooldownHours" FROM "ProMessagingSettings" WHERE "ownerUserId"=$1 LIMIT 1`,ctx.ownerUserId),
  prisma.$queryRawUnsafe<Array<any>>(`SELECT "id","label","body","sortOrder","active" FROM "ProQuickReply" WHERE "ownerUserId"=$1 AND "active"=TRUE ORDER BY "sortOrder","createdAt"`,ctx.ownerUserId)
 ]);return reply.send({sector:ctx.sector,settings:settings[0],quickReplies:replies});});

 app.put("/pro/message-tools/settings",async(request,reply)=>{const auth=await requireProfessionalContext(request,reply,"DASHBOARD");if(!auth)return;const{ctx}=auth;const body=z.object({awayEnabled:z.boolean(),awayMessage:z.string().trim().min(3).max(1000),businessStart:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),businessEnd:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),workingDays:z.array(z.number().int().min(0).max(6)).min(1).max(7),cooldownHours:z.number().int().min(1).max(72).default(12)}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_settings"});if(hhmmMinutes(body.data.businessEnd)<=hhmmMinutes(body.data.businessStart))return reply.code(400).send({error:"invalid_business_hours"});await ensureDefaults(ctx.ownerUserId,ctx.sector);await prisma.$executeRawUnsafe(`UPDATE "ProMessagingSettings" SET "awayEnabled"=$2,"awayMessage"=$3,"businessStart"=$4,"businessEnd"=$5,"workingDays"=$6::jsonb,"cooldownHours"=$7,"updatedAt"=CURRENT_TIMESTAMP WHERE "ownerUserId"=$1`,ctx.ownerUserId,body.data.awayEnabled,body.data.awayMessage,body.data.businessStart,body.data.businessEnd,JSON.stringify(body.data.workingDays),body.data.cooldownHours);return reply.send({updated:true});});

 app.post("/pro/message-tools/quick-replies",async(request,reply)=>{const auth=await requireProfessionalContext(request,reply,"DASHBOARD");if(!auth)return;const{ctx}=auth;const body=z.object({label:z.string().trim().min(1).max(60),body:z.string().trim().min(1).max(1000)}).safeParse(request.body);if(!body.success)return reply.code(400).send({error:"invalid_quick_reply"});const count=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "ProQuickReply" WHERE "ownerUserId"=$1 AND "active"=TRUE`,ctx.ownerUserId);if(Number(count[0]?.count??0n)>=20)return reply.code(409).send({error:"quick_reply_limit"});const id=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "ProQuickReply" ("id","ownerUserId","label","body","sortOrder") VALUES ($1,$2,$3,$4,$5)`,id,ctx.ownerUserId,body.data.label,body.data.body,Number(count[0]?.count??0n));return reply.code(201).send({id});});

 app.patch("/pro/message-tools/quick-replies/:id",async(request,reply)=>{const auth=await requireProfessionalContext(request,reply,"DASHBOARD");if(!auth)return;const{ctx}=auth;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({label:z.string().trim().min(1).max(60).optional(),body:z.string().trim().min(1).max(1000).optional(),active:z.boolean().optional(),sortOrder:z.number().int().min(0).max(100).optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const rows=await prisma.$queryRawUnsafe<Array<any>>(`SELECT * FROM "ProQuickReply" WHERE "id"=$1 AND "ownerUserId"=$2 LIMIT 1`,params.data.id,ctx.ownerUserId);const x=rows[0];if(!x)return reply.code(404).send({error:"quick_reply_not_found"});await prisma.$executeRawUnsafe(`UPDATE "ProQuickReply" SET "label"=$2,"body"=$3,"active"=$4,"sortOrder"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,x.id,body.data.label??x.label,body.data.body??x.body,body.data.active??x.active,body.data.sortOrder??x.sortOrder);return reply.send({updated:true});});

 app.delete("/pro/message-tools/quick-replies/:id",async(request,reply)=>{const auth=await requireProfessionalContext(request,reply,"DASHBOARD");if(!auth)return;const{ctx}=auth;const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});const result=await prisma.$executeRawUnsafe(`DELETE FROM "ProQuickReply" WHERE "id"=$1 AND "ownerUserId"=$2`,params.data.id,ctx.ownerUserId);if(!result)return reply.code(404).send({error:"quick_reply_not_found"});return reply.send({deleted:true});});
}

