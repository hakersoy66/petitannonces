import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { categoryBelongsToRootSlug } from "./category-attributes.js";
import { deliverUserEvent } from "./notification-delivery.js";

const VACATION_ROOT_SLUG="vacances";
const WORKER_INTERVAL_MS=30*60_000;
const timeString=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const keyModes=["IN_PERSON","LOCKBOX","SMART_LOCK","RECEPTION","OTHER"] as const;
type KeyMode=typeof keyModes[number];
type StaySettings={listingId:string;checkInFrom:string;checkInUntil:string|null;checkOutUntil:string;keyHandoverMode:KeyMode;arrivalInstructions:string|null;accessInstructions:string|null;houseRules:string|null;autoGuestMessage:boolean;guestMessageHoursBefore:number;accessRevealHoursBefore:number;createdAt:Date;updatedAt:Date};

const defaults=(listingId:string):StaySettings=>({listingId,checkInFrom:"15:00",checkInUntil:"22:00",checkOutUntil:"11:00",keyHandoverMode:"IN_PERSON",arrivalInstructions:null,accessInstructions:null,houseRules:null,autoGuestMessage:true,guestMessageHoursBefore:48,accessRevealHoursBefore:48,createdAt:new Date(0),updatedAt:new Date(0)});
function cleanText(value:string|null|undefined){const v=(value??"").trim();return v||null}
function dateOnly(value:Date|string){return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10)}
function json(row:StaySettings){return{listingId:row.listingId,checkInFrom:row.checkInFrom,checkInUntil:row.checkInUntil,checkOutUntil:row.checkOutUntil,keyHandoverMode:row.keyHandoverMode,arrivalInstructions:row.arrivalInstructions,accessInstructions:row.accessInstructions,houseRules:row.houseRules,autoGuestMessage:row.autoGuestMessage,guestMessageHoursBefore:row.guestMessageHoursBefore,accessRevealHoursBefore:row.accessRevealHoursBefore,updatedAt:row.updatedAt.getTime()?row.updatedAt.toISOString():null}}
async function settings(listingId:string){const rows=await prisma.$queryRawUnsafe<StaySettings[]>(`SELECT * FROM "VacationStayOperations" WHERE "listingId"=$1 LIMIT 1`,listingId);return rows[0]??defaults(listingId)}
async function ownerListing(userId:string,listingId:string){const listing=await prisma.listing.findFirst({where:{id:listingId,sellerId:userId},select:{id:true,categoryId:true,title:true}});if(!listing||!(await categoryBelongsToRootSlug(listing.categoryId,VACATION_ROOT_SLUG)))return null;return listing}
function parisOffset(date:string,time:string){const probe=new Date(`${date}T${time}:00Z`);const name=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Paris",timeZoneName:"shortOffset",hour:"2-digit"}).formatToParts(probe).find(p=>p.type==="timeZoneName")?.value??"GMT+1";const m=name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);if(!m)return 60;const minutes=Number(m[2])*60+Number(m[3]??0);return m[1]==="-"?-minutes:minutes}
function checkInAt(date:string,time:string){const offset=parisOffset(date,time);return Date.parse(`${date}T${time}:00Z`)-offset*60_000}
function keyModeLabel(mode:KeyMode){return mode==="LOCKBOX"?"boîte à clés":mode==="SMART_LOCK"?"serrure connectée":mode==="RECEPTION"?"réception":mode==="OTHER"?"modalité indiquée par l’hôte":"remise en main propre"}

export async function ensureVacationStayOperationsSchema(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VacationStayOperations" (
  "listingId" TEXT PRIMARY KEY REFERENCES "Listing"("id") ON DELETE CASCADE,
  "checkInFrom" TEXT NOT NULL DEFAULT '15:00',
  "checkInUntil" TEXT NULL DEFAULT '22:00',
  "checkOutUntil" TEXT NOT NULL DEFAULT '11:00',
  "keyHandoverMode" TEXT NOT NULL DEFAULT 'IN_PERSON',
  "arrivalInstructions" TEXT NULL,
  "accessInstructions" TEXT NULL,
  "houseRules" TEXT NULL,
  "autoGuestMessage" BOOLEAN NOT NULL DEFAULT TRUE,
  "guestMessageHoursBefore" INTEGER NOT NULL DEFAULT 48,
  "accessRevealHoursBefore" INTEGER NOT NULL DEFAULT 48,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VacationStayOperations_key_mode" CHECK ("keyHandoverMode" IN ('IN_PERSON','LOCKBOX','SMART_LOCK','RECEPTION','OTHER')),
  CONSTRAINT "VacationStayOperations_message_hours" CHECK ("guestMessageHoursBefore" BETWEEN 1 AND 168),
  CONSTRAINT "VacationStayOperations_reveal_hours" CHECK ("accessRevealHoursBefore" BETWEEN 1 AND 168)
 )`);
}

export function registerVacationStayOperationsRoutes(app:FastifyInstance){
 app.get("/listings/:id/vacation-stay-operations",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});const listing=await ownerListing(user.id,params.data.id);if(!listing)return reply.code(404).send({error:"vacation_listing_not_found"});return reply.send({settings:json(await settings(listing.id))});
 });
 app.put("/listings/:id/vacation-stay-operations",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({checkInFrom:timeString,checkInUntil:timeString.nullable(),checkOutUntil:timeString,keyHandoverMode:z.enum(keyModes),arrivalInstructions:z.string().max(2500).nullable().optional(),accessInstructions:z.string().max(2500).nullable().optional(),houseRules:z.string().max(3500).nullable().optional(),autoGuestMessage:z.boolean(),guestMessageHoursBefore:z.number().int().min(1).max(168),accessRevealHoursBefore:z.number().int().min(1).max(168)}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const listing=await ownerListing(user.id,params.data.id);if(!listing)return reply.code(404).send({error:"vacation_listing_not_found"});const b=body.data;await prisma.$executeRawUnsafe(`INSERT INTO "VacationStayOperations" ("listingId","checkInFrom","checkInUntil","checkOutUntil","keyHandoverMode","arrivalInstructions","accessInstructions","houseRules","autoGuestMessage","guestMessageHoursBefore","accessRevealHoursBefore","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) ON CONFLICT ("listingId") DO UPDATE SET "checkInFrom"=EXCLUDED."checkInFrom","checkInUntil"=EXCLUDED."checkInUntil","checkOutUntil"=EXCLUDED."checkOutUntil","keyHandoverMode"=EXCLUDED."keyHandoverMode","arrivalInstructions"=EXCLUDED."arrivalInstructions","accessInstructions"=EXCLUDED."accessInstructions","houseRules"=EXCLUDED."houseRules","autoGuestMessage"=EXCLUDED."autoGuestMessage","guestMessageHoursBefore"=EXCLUDED."guestMessageHoursBefore","accessRevealHoursBefore"=EXCLUDED."accessRevealHoursBefore","updatedAt"=NOW()`,listing.id,b.checkInFrom,b.checkInUntil,b.checkOutUntil,b.keyHandoverMode,cleanText(b.arrivalInstructions),cleanText(b.accessInstructions),cleanText(b.houseRules),b.autoGuestMessage,b.guestMessageHoursBefore,b.accessRevealHoursBefore);return reply.send({saved:true,settings:json(await settings(listing.id))});
 });
 app.get("/vacances/reservations/:id/stay-guide",async(request,reply)=>{
  const user=await requireListingUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});type Row={id:string;listingId:string;guestId:string;hostId:string;status:string;checkIn:Date|string;checkOut:Date|string;title:string|null};const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT r."id",r."listingId",r."guestId",r."hostId",r."status",r."checkIn",r."checkOut",l."title" FROM "VacationReservationRequest" r JOIN "Listing" l ON l."id"=r."listingId" WHERE r."id"=$1 LIMIT 1`,params.data.id);const reservation=rows[0];if(!reservation||(reservation.guestId!==user.id&&reservation.hostId!==user.id))return reply.code(404).send({error:"reservation_not_found"});if(reservation.status!=="ACCEPTED")return reply.code(409).send({error:"reservation_not_accepted"});const s=await settings(reservation.listingId);const checkIn=dateOnly(reservation.checkIn);const revealAt=checkInAt(checkIn,s.checkInFrom)-s.accessRevealHoursBefore*3600_000;const hostView=reservation.hostId===user.id;const accessVisible=hostView||Date.now()>=revealAt;return reply.send({reservationId:reservation.id,listingId:reservation.listingId,title:reservation.title,checkIn,checkOut:dateOnly(reservation.checkOut),checkInFrom:s.checkInFrom,checkInUntil:s.checkInUntil,checkOutUntil:s.checkOutUntil,keyHandoverMode:s.keyHandoverMode,arrivalInstructions:s.arrivalInstructions,houseRules:s.houseRules,accessInstructions:accessVisible?s.accessInstructions:null,accessVisible,accessRevealAt:new Date(revealAt).toISOString()});
 });
}

export function startVacationPreArrivalWorker(log?:{info:(value:unknown,message?:string)=>void;error:(value:unknown,message?:string)=>void}){
 const run=async()=>{try{type Row={id:string;listingId:string;guestId:string;checkIn:Date|string;title:string|null;checkInFrom:string;checkInUntil:string|null;keyHandoverMode:KeyMode;guestMessageHoursBefore:number};const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT r."id",r."listingId",r."guestId",r."checkIn",l."title",o."checkInFrom",o."checkInUntil",o."keyHandoverMode",o."guestMessageHoursBefore" FROM "VacationReservationRequest" r JOIN "Listing" l ON l."id"=r."listingId" JOIN "VacationStayOperations" o ON o."listingId"=r."listingId" WHERE r."status"='ACCEPTED' AND o."autoGuestMessage"=TRUE AND r."checkIn">=CURRENT_DATE AND r."checkIn"<=CURRENT_DATE+INTERVAL '8 days'`);let sent=0;for(const row of rows){const date=dateOnly(row.checkIn),due=checkInAt(date,row.checkInFrom)-row.guestMessageHoursBefore*3600_000;if(Date.now()<due)continue;await deliverUserEvent({userId:row.guestId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Votre arrivée approche",body:`Votre séjour ${row.title?`« ${row.title} »`:"Petit Annonces Vacances"} commence bientôt. Arrivée à partir de ${row.checkInFrom}${row.checkInUntil?` jusqu’à ${row.checkInUntil}`:""} · remise des clés : ${keyModeLabel(row.keyHandoverMode)}. Consultez les instructions dans Mes séjours.`,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:`vacation-stay:${row.id}:prearrival`,metadata:{reservationId:row.id,listingId:row.listingId,state:"PRE_ARRIVAL"}}).catch(()=>undefined);sent++}if(sent)log?.info({sent},"vacation pre-arrival notifications processed")}catch(error){log?.error({error},"vacation pre-arrival worker failed")}};const first=setTimeout(()=>void run(),75_000);first.unref();const timer=setInterval(()=>void run(),WORKER_INTERVAL_MS);timer.unref();return timer;
}
