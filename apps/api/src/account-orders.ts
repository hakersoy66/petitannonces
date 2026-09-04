import { createHash } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const SESSION_COOKIE = "pa_session";
function sha256(value:string){return createHash("sha256").update(value).digest("hex")}
async function requireUser(request:FastifyRequest, reply:FastifyReply){const token=request.cookies[SESSION_COOKIE];if(!token){reply.code(401).send({error:"unauthorized"});return null}const session=await prisma.session.findUnique({where:{tokenHash:sha256(token)},include:{user:true}});if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"){reply.code(401).send({error:"unauthorized"});return null}return session.user}

export async function registerAccountOrderRoutes(app:FastifyInstance){
  app.get("/account/orders",async(request,reply)=>{const user=await requireUser(request,reply);if(!user)return;
    const orders=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`
      SELECT o.*, l."title", l."slug", l."city",
        s."status" AS "shipmentStatus", s."carrier", s."trackingNumber", s."trackingUrl", s."estimatedDeliveryAt", s."deliveredAt",
        bp."confirmationStatus" AS "protectionStatus", bp."endsAt" AS "protectionEndsAt",
        d."id" AS "disputeId", d."status" AS "disputeStatus", d."reason" AS "disputeReason",
        p."status" AS "paymentStatus",
        po."status" AS "payoutStatus"
      FROM "MarketplaceOrder" o
      JOIN "Listing" l ON l."id"=o."listingId"
      LEFT JOIN "MarketplaceShipment" s ON s."orderId"=o."id"
      LEFT JOIN "BuyerProtectionWindow" bp ON bp."orderId"=o."id"
      LEFT JOIN LATERAL (SELECT * FROM "MarketplaceDispute" md WHERE md."orderId"=o."id" ORDER BY md."createdAt" DESC LIMIT 1) d ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM "MarketplacePayment" mp WHERE mp."orderId"=o."id" ORDER BY mp."createdAt" DESC LIMIT 1) p ON TRUE
      LEFT JOIN "MarketplacePayout" po ON po."orderId"=o."id"
      WHERE o."buyerId"=$1 OR o."sellerId"=$1
      ORDER BY o."updatedAt" DESC LIMIT 100`,user.id);
    const mapped=orders.map(o=>({...o,role:o.buyerId===user.id?"BUYER":"SELLER"}));
    return reply.send({orders:mapped,summary:{purchases:mapped.filter(o=>o.role==="BUYER").length,sales:mapped.filter(o=>o.role==="SELLER").length,active:mapped.filter(o=>!["COMPLETED","CANCELED","REFUNDED"].includes(String(o.status))).length,disputes:mapped.filter(o=>o.disputeId&&!["RESOLVED_BUYER","RESOLVED_SELLER","CLOSED"].includes(String(o.disputeStatus))).length}})
  })
}
