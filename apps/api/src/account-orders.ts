import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const SESSION_COOKIE = "pa_session";
function sha256(value:string){return createHash("sha256").update(value).digest("hex")}
async function requireUser(request:FastifyRequest, reply:FastifyReply){const token=request.cookies[SESSION_COOKIE];if(!token){reply.code(401).send({error:"unauthorized"});return null}const session=await prisma.session.findUnique({where:{tokenHash:sha256(token)},include:{user:true}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"){reply.code(401).send({error:"unauthorized"});return null}return session.user}

type AccountOrderRow = Record<string, any> & { role: "BUYER" | "SELLER"; status?: string; disputeId?: string | null; disputeStatus?: string | null };

async function getAccountOrder(userId:string, orderId:string){
  const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`
    SELECT o.*, l."title", l."slug", l."city", l."sellerId",
      s."status" AS "shipmentStatus", s."carrier", s."service", s."trackingNumber", s."trackingUrl", s."labelUrl", s."estimatedDeliveryAt", s."deliveredAt",
      bp."confirmationStatus" AS "protectionStatus", bp."endsAt" AS "protectionEndsAt",
      d."id" AS "disputeId", d."status" AS "disputeStatus", d."reason" AS "disputeReason", d."summary" AS "disputeSummary",
      p."status" AS "paymentStatus",
      po."status" AS "payoutStatus",
      rr."id" AS "returnRequestId", rr."status" AS "returnRequestStatus", rr."reason" AS "returnRequestReason", rr."details" AS "returnRequestDetails"
    FROM "MarketplaceOrder" o
    JOIN "Listing" l ON l."id"=o."listingId"
    LEFT JOIN "MarketplaceShipment" s ON s."orderId"=o."id"
    LEFT JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id"
    LEFT JOIN LATERAL (SELECT * FROM "MarketplaceDispute" md WHERE md."orderId"=o."id" ORDER BY md."createdAt" DESC LIMIT 1) d ON TRUE
    LEFT JOIN LATERAL (SELECT * FROM "MarketplacePayment" mp WHERE mp."orderId"=o."id" ORDER BY mp."createdAt" DESC LIMIT 1) p ON TRUE
    LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id"
    LEFT JOIN LATERAL (SELECT * FROM "MarketplaceReturnRequest" mr WHERE mr."orderId"=o."id" ORDER BY mr."createdAt" DESC LIMIT 1) rr ON TRUE
    WHERE o."id"=$1 AND (o."buyerId"=$2 OR o."sellerId"=$2) LIMIT 1`,orderId,userId);
  return rows[0]??null;
}

export async function registerAccountOrderRoutes(app:FastifyInstance){
  app.get("/account/orders",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;
    const orders=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`
      SELECT o.*, l."title", l."slug", l."city",
        s."status" AS "shipmentStatus", s."carrier", s."trackingNumber", s."trackingUrl", s."estimatedDeliveryAt", s."deliveredAt",
        bp."confirmationStatus" AS "protectionStatus", bp."endsAt" AS "protectionEndsAt",
        d."id" AS "disputeId", d."status" AS "disputeStatus", d."reason" AS "disputeReason",
        p."status" AS "paymentStatus",
        po."status" AS "payoutStatus",
        rr."id" AS "returnRequestId", rr."status" AS "returnRequestStatus"
      FROM "MarketplaceOrder" o
      JOIN "Listing" l ON l."id"=o."listingId"
      LEFT JOIN "MarketplaceShipment" s ON s."orderId"=o."id"
      LEFT JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id"
      LEFT JOIN LATERAL (SELECT * FROM "MarketplaceDispute" md WHERE md."orderId"=o."id" ORDER BY md."createdAt" DESC LIMIT 1) d ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM "MarketplacePayment" mp WHERE mp."orderId"=o."id" ORDER BY mp."createdAt" DESC LIMIT 1) p ON TRUE
      LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id"
      LEFT JOIN LATERAL (SELECT * FROM "MarketplaceReturnRequest" mr WHERE mr."orderId"=o."id" ORDER BY mr."createdAt" DESC LIMIT 1) rr ON TRUE
      WHERE o."buyerId"=$1 OR o."sellerId"=$1
      ORDER BY o."updatedAt" DESC LIMIT 100`,user.id);
    const mapped:AccountOrderRow[]=orders.map(o=>({...o,role:o.buyerId===user.id?"BUYER":"SELLER"}));
    return reply.send({orders:mapped,summary:{purchases:mapped.filter(o=>o.role==="BUYER").length,sales:mapped.filter(o=>o.role==="SELLER").length,active:mapped.filter(o=>!["COMPLETED","CANCELED","REFUNDED"].includes(String(o.status))).length,disputes:mapped.filter(o=>o.disputeId&&!["RESOLVED_BUYER","RESOLVED_SELLER","CLOSED"].includes(String(o.disputeStatus))).length}})
  });

  app.get("/account/orders/:id",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_order"});const order=await getAccountOrder(user.id,params.data.id);if(!order)return reply.code(404).send({error:"order_not_found"});return reply.send({order:{...order,role:order.buyerId===user.id?"BUYER":"SELLER"}})});

  app.post("/account/orders/:id/return-request",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({reason:z.string().trim().min(3).max(120),details:z.string().trim().min(10).max(2000)}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});const order=await getAccountOrder(user.id,params.data.id);if(!order)return reply.code(404).send({error:"order_not_found"});if(!["PAID","PROCESSING","SHIPPED","DELIVERED"].includes(String(order.status)))return reply.code(409).send({error:"return_request_not_available"});try{const id=randomUUID();await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceReturnRequest" ("id","orderId","requestedById","reason","details") VALUES ($1,$2,$3,$4,$5)`,id,order.id,user.id,body.data.reason,body.data.details);return reply.code(201).send({returnRequest:{id,status:"OPEN"}})}catch(error){if(String(error).includes("MarketplaceReturnRequest_active_order_idx"))return reply.code(409).send({error:"active_return_request_exists"});throw error}});
}
