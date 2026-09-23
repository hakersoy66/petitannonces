import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { categoryBelongsToRootSlug } from "./category-attributes.js";
import { deliverUserEvent } from "./notification-delivery.js";

const VACATION_ROOT_SLUG="vacances";
const MAX_ICAL_BYTES=2*1024*1024;
const MAX_ICAL_EVENTS=1500;
const MAX_SOURCES_PER_LISTING=5;
const SYNC_INTERVAL_MS=30*60_000;

type CalendarSource={id:string;listingId:string;label:string;url:string;enabled:boolean;lastSyncAt:Date|null;lastSuccessAt:Date|null;lastError:string|null;eventCount:number;conflictCount:number;createdAt:Date;updatedAt:Date};
type IcalEvent={uid:string;startDate:string;endDate:string};

function isPrivateIp(ip:string){
  if(ip.toLowerCase().startsWith("::ffff:"))return isPrivateIp(ip.slice(7));
  if(net.isIPv4(ip)){const p=ip.split(".").map(Number),a=p[0]??-1,b=p[1]??-1;return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a>=224)}
  if(net.isIPv6(ip)){const v=ip.toLowerCase();return v==="::"||v==="::1"||v.startsWith("fc")||v.startsWith("fd")||v.startsWith("fe80:")}
  return true;
}

async function safeCalendarUrl(raw:string){
  if(raw.length>2048)throw new Error("calendar_url_too_long");
  const u=new URL(raw);
  if(u.protocol!=="https:")throw new Error("calendar_https_required");
  if(u.username||u.password)throw new Error("calendar_credentials_not_allowed");
  if(u.port&&u.port!=="443")throw new Error("calendar_port_not_allowed");
  const host=u.hostname.toLowerCase();
  if(host==="localhost"||host==="0.0.0.0"||host==="petitannonces.fr"||host.endsWith(".petitannonces.fr"))throw new Error("unsafe_calendar_url");
  const addresses=await lookup(u.hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(a=>isPrivateIp(a.address)))throw new Error("unsafe_calendar_url");
  return u;
}

async function readLimitedBody(response:Response){
  const length=Number(response.headers.get("content-length")??0);if(length>MAX_ICAL_BYTES)throw new Error("calendar_too_large");
  const reader=response.body?.getReader();if(!reader)return"";const chunks:Uint8Array[]=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;if(value){total+=value.byteLength;if(total>MAX_ICAL_BYTES){await reader.cancel();throw new Error("calendar_too_large")}chunks.push(value)}}
  const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength}return new TextDecoder("utf-8").decode(out);
}

async function fetchCalendar(raw:string){
  let current=(await safeCalendarUrl(raw)).toString();
  for(let redirect=0;redirect<4;redirect++){
    const response=await fetch(current,{redirect:"manual",signal:AbortSignal.timeout(12_000),headers:{accept:"text/calendar,text/plain;q=0.9,*/*;q=0.2","accept-language":"fr-FR,fr;q=0.9","user-agent":"PetitAnnonces-Vacances-Calendar/1.0"}});
    if(response.status>=300&&response.status<400){const location=response.headers.get("location");if(!location)throw new Error("calendar_redirect_missing");current=(await safeCalendarUrl(new URL(location,current).toString())).toString();continue}
    if(!response.ok)throw new Error(`calendar_http_${response.status}`);
    return readLimitedBody(response);
  }
  throw new Error("calendar_too_many_redirects");
}

function parseIcalDate(value:string){const m=value.trim().match(/^(\d{4})(\d{2})(\d{2})/);if(!m)return null;const date=`${m[1]}-${m[2]}-${m[3]}`;return Number.isNaN(Date.parse(`${date}T00:00:00Z`))?null:date}
function addDays(date:string,days:number){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export function parseVacationIcal(text:string):IcalEvent[]{
  if(!text.includes("BEGIN:VCALENDAR"))throw new Error("invalid_calendar_format");
  const unfolded=text.replace(/\r\n[ \t]/g,"").replace(/\n[ \t]/g,"");const events:IcalEvent[]=[];let current:Record<string,string>|null=null;
  for(const rawLine of unfolded.split(/\r?\n/)){
    const line=rawLine.trimEnd();if(line==="BEGIN:VEVENT"){current={};continue}if(line==="END:VEVENT"){
      if(current&&current.STATUS!=="CANCELLED"){
        const start=parseIcalDate(current.DTSTART??"");if(start){let end=parseIcalDate(current.DTEND??"")??addDays(start,1);if(end<=start)end=addDays(start,1);const seed=current.UID||`${start}|${end}|${current.SUMMARY??""}`;const uid=createHash("sha256").update(seed).digest("hex").slice(0,48);events.push({uid,startDate:start,endDate:end})}
      }
      current=null;if(events.length>MAX_ICAL_EVENTS)throw new Error("calendar_too_many_events");continue
    }
    if(!current)continue;const colon=line.indexOf(":");if(colon<1)continue;const key=line.slice(0,colon).split(";",1)[0]!.toUpperCase();if(["UID","DTSTART","DTEND","STATUS","SUMMARY"].includes(key))current[key]=line.slice(colon+1).trim();
  }
  const today=new Date().toISOString().slice(0,10),min=addDays(today,-60),max=addDays(today,730);const unique=new Map<string,IcalEvent>();for(const event of events)if(event.endDate>=min&&event.startDate<=max)unique.set(event.uid,event);return [...unique.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate));
}

function sourceJson(row:CalendarSource){return{id:row.id,label:row.label,url:row.url,enabled:row.enabled,lastSyncAt:row.lastSyncAt?.toISOString()??null,lastSuccessAt:row.lastSuccessAt?.toISOString()??null,lastError:row.lastError,eventCount:row.eventCount,conflictCount:row.conflictCount,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()}}
function calendarError(error:unknown){const raw=error instanceof Error?error.message:"calendar_sync_failed";return raw.slice(0,240)}

export async function ensureVacationIcalSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VacationCalendarSource" (
    "id" TEXT PRIMARY KEY,
    "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "lastSyncAt" TIMESTAMPTZ NULL,
    "lastSuccessAt" TIMESTAMPTZ NULL,
    "lastError" TEXT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "VacationCalendarSource" ADD COLUMN IF NOT EXISTS "conflictCount" INTEGER NOT NULL DEFAULT 0`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VacationCalendarSource_listing_idx" ON "VacationCalendarSource" ("listingId","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VacationCalendarExport" (
    "listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,
    "token" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "VacationAvailabilityBlock" ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT 'MANUAL'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "VacationAvailabilityBlock" ADD COLUMN IF NOT EXISTS "sourceId" TEXT NULL`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "VacationAvailabilityBlock" ADD COLUMN IF NOT EXISTS "externalUid" TEXT NULL`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "VacationAvailabilityBlock_external_uid_idx" ON "VacationAvailabilityBlock" ("sourceId","externalUid") WHERE "sourceId" IS NOT NULL AND "externalUid" IS NOT NULL`);
}

async function ownerListing(userId:string,listingId:string){const listing=await prisma.listing.findFirst({where:{id:listingId,sellerId:userId},select:{id:true,categoryId:true,title:true}});if(!listing||!(await categoryBelongsToRootSlug(listing.categoryId,VACATION_ROOT_SLUG)))return null;return listing}
async function exportToken(listingId:string){const existing=await prisma.$queryRawUnsafe<Array<{token:string}>>(`SELECT "token" FROM "VacationCalendarExport" WHERE "listingId"=$1 LIMIT 1`,listingId);if(existing[0])return existing[0].token;const token=randomBytes(24).toString("base64url");await prisma.$executeRawUnsafe(`INSERT INTO "VacationCalendarExport" ("listingId","token","createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW()) ON CONFLICT ("listingId") DO NOTHING`,listingId,token);const saved=await prisma.$queryRawUnsafe<Array<{token:string}>>(`SELECT "token" FROM "VacationCalendarExport" WHERE "listingId"=$1 LIMIT 1`,listingId);return saved[0]?.token??token}

async function notifyCalendarOwner(source:CalendarSource,input:{title:string;body:string;dedupeKey:string;metadata?:Record<string,unknown>}){
  const rows=await prisma.$queryRawUnsafe<Array<{sellerId:string;title:string|null}>>(`SELECT "sellerId","title" FROM "Listing" WHERE "id"=$1 LIMIT 1`,source.listingId);
  const owner=rows[0];if(!owner)return;
  await deliverUserEvent({userId:owner.sellerId,eventKind:"LISTING",notificationKind:"SYSTEM",title:input.title,body:input.body,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:input.dedupeKey,metadata:{listingId:source.listingId,calendarSourceId:source.id,calendarLabel:source.label,...(input.metadata??{})}}).catch(()=>undefined);
}

export async function syncVacationCalendarSource(sourceId:string){
  const rows=await prisma.$queryRawUnsafe<CalendarSource[]>(`SELECT * FROM "VacationCalendarSource" WHERE "id"=$1 AND "enabled"=TRUE LIMIT 1`,sourceId);const source=rows[0];if(!source)return{ok:false,error:"calendar_source_not_found",eventCount:0,conflictCount:0};
  try{
    const text=await fetchCalendar(source.url);const events=parseVacationIcal(text);const now=new Date().toISOString();let conflictCount=0;
    await prisma.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`,`vacation-ical:${source.id}`);
      await tx.$executeRawUnsafe(`DELETE FROM "VacationAvailabilityBlock" WHERE "sourceId"=$1 AND "sourceType"='ICAL'`,source.id);
      for(const event of events)await tx.$executeRawUnsafe(`INSERT INTO "VacationAvailabilityBlock" ("id","listingId","startDate","endDate","note","sourceType","sourceId","externalUid","createdAt") VALUES ($1,$2,$3::date,$4::date,$5,'ICAL',$6,$7,NOW())`,randomUUID(),source.listingId,event.startDate,event.endDate,`Réservation externe · ${source.label}`,source.id,event.uid);
      const conflicts=await tx.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(DISTINCT r."id")::bigint AS count FROM "VacationReservationRequest" r JOIN "VacationAvailabilityBlock" b ON b."listingId"=r."listingId" AND b."sourceId"=$1 AND b."sourceType"='ICAL' AND b."startDate"<r."checkOut" AND b."endDate">r."checkIn" WHERE r."status"='ACCEPTED'`,source.id);conflictCount=Number(conflicts[0]?.count??0);
      await tx.$executeRawUnsafe(`UPDATE "VacationCalendarSource" SET "lastSyncAt"=$2::timestamptz,"lastSuccessAt"=$2::timestamptz,"lastError"=NULL,"eventCount"=$3,"conflictCount"=$4,"updatedAt"=NOW() WHERE "id"=$1`,source.id,now,events.length,conflictCount);
    });
    if(source.lastError){
      await notifyCalendarOwner(source,{title:"Synchronisation iCal rétablie",body:`Le calendrier « ${source.label} » se synchronise de nouveau correctement. Les disponibilités ont été actualisées.`,dedupeKey:`vacation-ical:${source.id}:recovered:${source.lastSyncAt?.getTime()??0}`,metadata:{state:"RECOVERED",eventCount:events.length,conflictCount}});
    }
    if(conflictCount>0&&source.conflictCount===0){
      await notifyCalendarOwner(source,{title:"Conflit de calendrier Vacances",body:`${conflictCount} réservation${conflictCount>1?"s":""} Petit Annonces chevauche${conflictCount>1?"nt":""} des dates importées depuis « ${source.label} ». Vérifiez le calendrier avant l’arrivée des voyageurs.`,dedupeKey:`vacation-ical:${source.id}:conflict:${source.lastSuccessAt?.getTime()??0}`,metadata:{state:"CONFLICT",eventCount:events.length,conflictCount}});
    }else if(conflictCount===0&&source.conflictCount>0){
      await notifyCalendarOwner(source,{title:"Conflit iCal résolu",body:`Le conflit détecté sur le calendrier « ${source.label} » n’est plus présent après la dernière synchronisation.`,dedupeKey:`vacation-ical:${source.id}:conflict-resolved:${source.lastSuccessAt?.getTime()??0}`,metadata:{state:"CONFLICT_RESOLVED",eventCount:events.length,conflictCount:0}});
    }
    return{ok:true,eventCount:events.length,conflictCount,error:null};
  }catch(error){
    const message=calendarError(error);await prisma.$executeRawUnsafe(`UPDATE "VacationCalendarSource" SET "lastSyncAt"=NOW(),"lastError"=$2,"updatedAt"=NOW() WHERE "id"=$1`,source.id,message).catch(()=>undefined);
    if(!source.lastError){
      await notifyCalendarOwner(source,{title:"Calendrier externe inaccessible",body:`Petit Annonces n’arrive plus à synchroniser « ${source.label} ». Les dernières dates connues restent bloquées par sécurité. Vérifiez l’URL iCal depuis votre calendrier Vacances.`,dedupeKey:`vacation-ical:${source.id}:error:${source.lastSuccessAt?.getTime()??0}`,metadata:{state:"ERROR",error:message}});
    }
    return{ok:false,eventCount:source.eventCount,conflictCount:source.conflictCount,error:message};
  }
}

function icalEscape(value:string){return value.replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;")}
function icalDate(value:Date|string){const d=typeof value==="string"?value.slice(0,10):value.toISOString().slice(0,10);return d.replace(/-/g,"")}

export function registerVacationIcalRoutes(app:FastifyInstance){
  app.get("/vacances/calendar-feed/:token.ics",async(request,reply)=>{
    const params=z.object({token:z.string().min(20).max(100)}).safeParse(request.params);if(!params.success)return reply.code(404).send("Not found");
    type Row={listingId:string;title:string|null;id:string|null;startDate:Date|string|null;endDate:Date|string|null};const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT e."listingId",l."title",b."id",b."startDate",b."endDate" FROM "VacationCalendarExport" e JOIN "Listing" l ON l."id"=e."listingId" LEFT JOIN "VacationAvailabilityBlock" b ON b."listingId"=e."listingId" AND b."endDate">=(CURRENT_DATE-INTERVAL '60 days') AND COALESCE(b."sourceType",'MANUAL')<>'ICAL' WHERE e."token"=$1 ORDER BY b."startDate" ASC`,params.data.token);if(!rows.length)return reply.code(404).send("Not found");const title=rows[0]?.title??"Hébergement Vacances";const now=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Petit Annonces//Vacances//FR","CALSCALE:GREGORIAN","METHOD:PUBLISH",`X-WR-CALNAME:${icalEscape(`Petit Annonces Vacances · ${title}`)}`];for(const row of rows){if(!row.id||!row.startDate||!row.endDate)continue;lines.push("BEGIN:VEVENT",`UID:pa-${row.id}@petitannonces.fr`,`DTSTAMP:${now}`,`DTSTART;VALUE=DATE:${icalDate(row.startDate)}`,`DTEND;VALUE=DATE:${icalDate(row.endDate)}`,"SUMMARY:Indisponible · Petit Annonces","TRANSP:OPAQUE","END:VEVENT")}lines.push("END:VCALENDAR","");return reply.header("content-type","text/calendar; charset=utf-8").header("cache-control","private, max-age=300").header("x-robots-tag","noindex, nofollow, noarchive").send(lines.join("\r\n"));
  });

  app.get("/listings/:id/vacation-calendar-sync",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});const listing=await ownerListing(user.id,params.data.id);if(!listing)return reply.code(404).send({error:"vacation_listing_not_found"});const [sources,token]=await Promise.all([prisma.$queryRawUnsafe<CalendarSource[]>(`SELECT * FROM "VacationCalendarSource" WHERE "listingId"=$1 ORDER BY "createdAt" ASC`,listing.id),exportToken(listing.id)]);return reply.send({sources:sources.map(sourceJson),exportPath:`/api/vacances/calendar-feed/${token}.ics`,syncIntervalMinutes:30,maxSources:MAX_SOURCES_PER_LISTING});
  });

  app.post("/listings/:id/vacation-calendar-sync/sources",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({url:z.string().trim().url().max(2048),label:z.string().trim().max(80).optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const listing=await ownerListing(user.id,params.data.id);if(!listing)return reply.code(404).send({error:"vacation_listing_not_found"});let u:URL;try{u=await safeCalendarUrl(body.data.url)}catch(error){return reply.code(400).send({error:calendarError(error)})}const count=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "VacationCalendarSource" WHERE "listingId"=$1`,listing.id);if(Number(count[0]?.count??0)>=MAX_SOURCES_PER_LISTING)return reply.code(409).send({error:"calendar_source_limit"});const id=randomUUID(),label=body.data.label?.trim()||u.hostname.replace(/^www\./,"");await prisma.$executeRawUnsafe(`INSERT INTO "VacationCalendarSource" ("id","listingId","label","url","enabled","createdAt","updatedAt") VALUES ($1,$2,$3,$4,TRUE,NOW(),NOW())`,id,listing.id,label,u.toString());const sync=await syncVacationCalendarSource(id);const source=(await prisma.$queryRawUnsafe<CalendarSource[]>(`SELECT * FROM "VacationCalendarSource" WHERE "id"=$1 LIMIT 1`,id))[0]!;return reply.code(201).send({source:sourceJson(source),sync});
  });

  app.post("/listings/:id/vacation-calendar-sync/sources/:sourceId/sync",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1),sourceId:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});const listing=await ownerListing(user.id,params.data.id);if(!listing)return reply.code(404).send({error:"vacation_listing_not_found"});const source=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "VacationCalendarSource" WHERE "id"=$1 AND "listingId"=$2 LIMIT 1`,params.data.sourceId,listing.id);if(!source.length)return reply.code(404).send({error:"calendar_source_not_found"});const sync=await syncVacationCalendarSource(params.data.sourceId);return reply.code(sync.ok?200:502).send(sync);
  });

  app.delete("/listings/:id/vacation-calendar-sync/sources/:sourceId",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1),sourceId:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});const listing=await ownerListing(user.id,params.data.id);if(!listing)return reply.code(404).send({error:"vacation_listing_not_found"});await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe(`DELETE FROM "VacationAvailabilityBlock" WHERE "sourceId"=$1 AND "listingId"=$2 AND "sourceType"='ICAL'`,params.data.sourceId,listing.id);await tx.$executeRawUnsafe(`DELETE FROM "VacationCalendarSource" WHERE "id"=$1 AND "listingId"=$2`,params.data.sourceId,listing.id)});return reply.code(204).send();
  });

  app.post("/listings/:id/vacation-calendar-sync/export/rotate",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});const listing=await ownerListing(user.id,params.data.id);if(!listing)return reply.code(404).send({error:"vacation_listing_not_found"});const token=randomBytes(24).toString("base64url");await prisma.$executeRawUnsafe(`INSERT INTO "VacationCalendarExport" ("listingId","token","createdAt","updatedAt") VALUES ($1,$2,NOW(),NOW()) ON CONFLICT ("listingId") DO UPDATE SET "token"=EXCLUDED."token","updatedAt"=NOW()`,listing.id,token);return reply.send({exportPath:`/api/vacances/calendar-feed/${token}.ics`});
  });
}

export function startVacationIcalSyncWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
  const run=async()=>{try{const rows=await prisma.$queryRawUnsafe<Array<{id:string}>>(`SELECT "id" FROM "VacationCalendarSource" WHERE "enabled"=TRUE AND ("lastSyncAt" IS NULL OR "lastSyncAt"<NOW()-INTERVAL '30 minutes') ORDER BY COALESCE("lastSyncAt",TO_TIMESTAMP(0)) ASC LIMIT 40`);for(const row of rows){const result=await syncVacationCalendarSource(row.id);if(!result.ok)log?.error({sourceId:row.id,error:result.error},"vacation iCal sync failed")}if(rows.length)log?.info({sources:rows.length},"vacation iCal sync completed")}catch(error){log?.error({error},"vacation iCal sync worker failed")}};const first=setTimeout(()=>void run(),45_000);first.unref();const timer=setInterval(()=>void run(),SYNC_INTERVAL_MS);timer.unref();return timer;
}
