import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireListingUser } from "./listing-auth.js";
import { deliverUserEvent } from "./notification-delivery.js";

function parisToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function isoDate(value:Date|string){return typeof value==="string"?value.slice(0,10):value.toISOString().slice(0,10)}

export async function ensureVacationReviewSchema(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VacationStayReview" (
    "id" TEXT PRIMARY KEY,
    "reservationId" TEXT NOT NULL REFERENCES "VacationReservationRequest"("id") ON DELETE CASCADE,
    "listingId" TEXT NOT NULL REFERENCES "Listing"("id") ON DELETE CASCADE,
    "reviewerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "revieweeId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "direction" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VacationStayReview_direction" CHECK ("direction" IN ('GUEST_TO_HOST','HOST_TO_GUEST')),
    CONSTRAINT "VacationStayReview_rating" CHECK ("rating">=1 AND "rating"<=5)
  )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "VacationStayReview_reservation_reviewer_unique" ON "VacationStayReview" ("reservationId","reviewerId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VacationStayReview_listing_idx" ON "VacationStayReview" ("listingId","createdAt" DESC)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VacationStayReview_reviewee_idx" ON "VacationStayReview" ("revieweeId","createdAt" DESC)`);
}

export function registerVacationReviewRoutes(app:FastifyInstance){
  app.get("/vacances/reservations/:id/review",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    type Row={id:string;listingId:string;guestId:string;hostId:string;status:string;checkOut:Date|string;title:string|null};
    const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT r."id",r."listingId",r."guestId",r."hostId",r."status",r."checkOut",l."title" FROM "VacationReservationRequest" r JOIN "Listing" l ON l."id"=r."listingId" WHERE r."id"=$1 LIMIT 1`,params.data.id);const reservation=rows[0];
    if(!reservation||(reservation.guestId!==user.id&&reservation.hostId!==user.id))return reply.code(404).send({error:"reservation_not_found"});
    const reviews=await prisma.$queryRawUnsafe<Array<{id:string;rating:number;comment:string|null;direction:string;createdAt:Date}>>(`SELECT "id","rating","comment","direction","createdAt" FROM "VacationStayReview" WHERE "reservationId"=$1 AND "reviewerId"=$2 LIMIT 1`,reservation.id,user.id);
    const eligible=reservation.status==="ACCEPTED"&&isoDate(reservation.checkOut)<=parisToday();return reply.send({eligible,review:reviews[0]?{...reviews[0],createdAt:reviews[0].createdAt.toISOString()}:null,listingTitle:reservation.title});
  });

  app.post("/vacances/reservations/:id/review",async(request,reply)=>{
    const user=await requireListingUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({rating:z.number().int().min(1).max(5),comment:z.string().trim().max(1200).optional()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    type Row={id:string;listingId:string;guestId:string;hostId:string;status:string;checkOut:Date|string;title:string|null};const rows=await prisma.$queryRawUnsafe<Row[]>(`SELECT r."id",r."listingId",r."guestId",r."hostId",r."status",r."checkOut",l."title" FROM "VacationReservationRequest" r JOIN "Listing" l ON l."id"=r."listingId" WHERE r."id"=$1 LIMIT 1`,params.data.id);const reservation=rows[0];
    if(!reservation||(reservation.guestId!==user.id&&reservation.hostId!==user.id))return reply.code(404).send({error:"reservation_not_found"});if(reservation.status!=="ACCEPTED"||isoDate(reservation.checkOut)>parisToday())return reply.code(409).send({error:"review_not_eligible"});
    const direction=reservation.guestId===user.id?"GUEST_TO_HOST":"HOST_TO_GUEST",revieweeId=reservation.guestId===user.id?reservation.hostId:reservation.guestId,id=randomUUID();
    try{await prisma.$executeRawUnsafe(`INSERT INTO "VacationStayReview" ("id","reservationId","listingId","reviewerId","revieweeId","direction","rating","comment","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,id,reservation.id,reservation.listingId,user.id,revieweeId,direction,body.data.rating,body.data.comment?.trim()||null)}catch(error:any){if(String(error?.code??"")==="P2010"||String(error?.message??"").includes("unique"))return reply.code(409).send({error:"review_already_submitted"});throw error}
    await deliverUserEvent({userId:revieweeId,eventKind:"LISTING",notificationKind:"SYSTEM",title:"Nouvel avis Vacances",body:`Un avis ${body.data.rating}/5 a été publié après un séjour vérifié${reservation.title?` pour ${reservation.title}`:""}.`,actionUrl:"/mon-compte/reservations",transactional:true,dedupeKey:`vacation-review:${reservation.id}:${user.id}`,metadata:{reservationId:reservation.id,listingId:reservation.listingId,rating:body.data.rating,direction}}).catch(()=>undefined);
    return reply.code(201).send({review:{id,rating:body.data.rating,comment:body.data.comment?.trim()||null,direction,verifiedStay:true}});
  });

  app.get("/vacances/listings/:id/reviews",async(request,reply)=>{
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const query=z.object({limit:z.coerce.number().int().min(1).max(30).default(8)}).safeParse(request.query);if(!params.success||!query.success)return reply.code(400).send({error:"invalid_request"});
    const listing=await prisma.listing.findFirst({where:{id:params.data.id,status:"PUBLISHED"},select:{id:true}});if(!listing)return reply.code(404).send({error:"listing_not_found"});
    const [summary,rows]=await Promise.all([
      prisma.$queryRawUnsafe<Array<{count:bigint;average:number|null}>>(`SELECT COUNT(*)::bigint AS count,AVG("rating")::float AS average FROM "VacationStayReview" WHERE "listingId"=$1 AND "direction"='GUEST_TO_HOST'`,listing.id),
      prisma.$queryRawUnsafe<Array<{id:string;rating:number;comment:string|null;createdAt:Date;reviewerName:string|null}>>(`SELECT r."id",r."rating",r."comment",r."createdAt",COALESCE(p."displayName",p."firstName",'Voyageur Petit Annonces') AS "reviewerName" FROM "VacationStayReview" r LEFT JOIN "UserProfile" p ON p."userId"=r."reviewerId" WHERE r."listingId"=$1 AND r."direction"='GUEST_TO_HOST' ORDER BY r."createdAt" DESC LIMIT $2`,listing.id,query.data.limit)
    ]);
    return reply.send({summary:{count:Number(summary[0]?.count??0),average:summary[0]?.average??null},reviews:rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),verifiedStay:true}))});
  });
}
