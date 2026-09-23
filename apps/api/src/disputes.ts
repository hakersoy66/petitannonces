import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { deliverUserEvent } from "./notification-delivery.js";
import { issueMarketplaceRefund, retryMarketplaceRefund } from "./payments.js";
import { ensureReturnWorkflowSchema } from "./return-workflow.js";
import { createPresignedDownload, makeStoredObjectPrivate, storageConfigured, uploadPrivateStoredObject } from "./storage.js";

const SESSION_COOKIE = "pa_session";
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const authHeader=typeof request.headers.authorization==="string"?request.headers.authorization.trim():"";const bearer=/^Bearer\s+(.+)$/i.exec(authHeader)?.[1]?.trim()||null;const token=bearer??request.cookies[SESSION_COOKIE];
  if (!token) { reply.code(401).send({ error: "unauthorized" }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { roles: true } } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") {
    reply.code(401).send({ error: "unauthorized" }); return null;
  }
  return session.user;
}

async function getOrder(orderId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(`SELECT * FROM "MarketplaceOrder" WHERE "id"=$1 LIMIT 1`, orderId);
  return rows[0] ?? null;
}

async function getDispute(disputeId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(`SELECT * FROM "MarketplaceDispute" WHERE "id"=$1 LIMIT 1`, disputeId);
  return rows[0] ?? null;
}

const EVIDENCE_MIME_TYPES=new Set(["image/jpeg","image/png","image/webp","image/avif","application/pdf"]);
const MAX_EVIDENCE_BYTES=10*1024*1024;
function evidenceExtension(mimeType:string){return mimeType==="application/pdf"?"pdf":mimeType==="image/jpeg"?"jpg":mimeType==="image/png"?"png":mimeType==="image/avif"?"avif":"webp"}
function evidenceObjectKeyFromLegacyUrl(fileUrl:unknown){
  if(typeof fileUrl!=="string"||!fileUrl)return null;
  try{const u=new URL(fileUrl);const marker="/disputes/";const i=u.pathname.indexOf(marker);if(i<0)return null;return decodeURIComponent(u.pathname.slice(i+1));}catch{return null}
}
function evidencePublicShape(row:Record<string,any>){return{id:row.id,disputeId:row.disputeId,uploadedById:row.uploadedById,fileName:row.fileName,mimeType:row.mimeType,sizeBytes:row.sizeBytes,createdAt:row.createdAt,downloadUrl:`/api/disputes/${row.disputeId}/evidence/${row.id}/download`}}
async function notifyOrderParty(userId:string,title:string,body:string,orderId:string){await deliverUserEvent({userId,eventKind:"LISTING",notificationKind:"SYSTEM",title,body,actionUrl:`/commandes/${orderId}`,transactional:true,metadata:{orderId,caseUpdate:true}}).catch(()=>undefined)}

function isDisputeStaff(user: { roles: Array<{ role: string }> }) {
  return user.roles.some((item) => ["SUPER_ADMIN","ADMIN","SUPPORT","FINANCE","COMPLIANCE","MODERATOR"].includes(item.role));
}

async function auditCaseDecision(actorUserId:string,action:string,entityType:"DISPUTE"|"RETURN"|"REFUND",entityId:string,metadata?:unknown){
  await prisma.$executeRawUnsafe(`INSERT INTO "AdminAuditEvent" ("id","actorUserId","action","entityType","entityId","metadata") VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,randomUUID(),actorUserId,action,entityType,entityId,metadata?JSON.stringify(metadata):null);
}

type MarketplaceCaseType="dispute"|"return"|"refund";
function caseEntityType(type:MarketplaceCaseType){return type==="dispute"?"DISPUTE":type==="return"?"RETURN":"REFUND" as const}
async function caseOrderId(type:MarketplaceCaseType,id:string){
  if(type==="dispute"){const r=await prisma.$queryRawUnsafe<Array<{orderId:string}>>(`SELECT "orderId" FROM "MarketplaceDispute" WHERE "id"=$1 LIMIT 1`,id);return r[0]?.orderId??null}
  if(type==="return"){const r=await prisma.$queryRawUnsafe<Array<{orderId:string}>>(`SELECT "orderId" FROM "MarketplaceReturnRequest" WHERE "id"=$1 LIMIT 1`,id);return r[0]?.orderId??null}
  const r=await prisma.$queryRawUnsafe<Array<{orderId:string}>>(`SELECT "orderId" FROM "MarketplaceRefund" WHERE "id"=$1 LIMIT 1`,id);return r[0]?.orderId??null;
}
async function ensureCaseWorkspace(type:MarketplaceCaseType,id:string,orderId:string){
  await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceCaseWorkspace" ("id","caseType","caseId","orderId") VALUES ($1,$2,$3,$4) ON CONFLICT ("caseType","caseId") DO NOTHING`,randomUUID(),type,id,orderId);
  const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT w.*,COALESCE(p."displayName",p."firstName",u."email") AS "assignedToName",u."email" AS "assignedToEmail" FROM "MarketplaceCaseWorkspace" w LEFT JOIN "User" u ON u."id"=w."assignedToUserId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE w."caseType"=$1 AND w."caseId"=$2 LIMIT 1`,type,id);
  const workspace=rows[0];if(!workspace)throw new Error("case_workspace_unavailable");return workspace;
}

export async function registerDisputeRoutes(app: FastifyInstance) {
  await ensureReturnWorkflowSchema();
  app.addContentTypeParser("application/octet-stream",{parseAs:"buffer",bodyLimit:MAX_EVIDENCE_BYTES},(_request,body,done)=>done(null,body));
  app.post("/orders/:id/disputes", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ reason: z.enum(["ITEM_NOT_RECEIVED","ITEM_NOT_AS_DESCRIBED","DAMAGED_ITEM","COUNTERFEIT_SUSPECTED","MISSING_PARTS","WRONG_ITEM","OTHER"]), summary: z.string().trim().min(10).max(2000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const order = await getOrder(params.data.id); if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (order.buyerId !== user.id && order.sellerId !== user.id) return reply.code(403).send({ error: "forbidden" });
    if (!["PAID","PROCESSING","SHIPPED","DELIVERED"].includes(String(order.status))) return reply.code(409).send({ error: "order_not_disputable" });
    if(order.buyerId===user.id&&String(order.status)==="DELIVERED"){
      const protectionRows=await prisma.$queryRawUnsafe<Array<{confirmationStatus:string;endsAt:Date}>>(`SELECT "confirmationStatus"::text AS "confirmationStatus","endsAt" FROM "BuyerProtectionWindow" WHERE "orderId"=$1 LIMIT 1`,order.id);
      const protection=protectionRows[0];
      if(!protection||protection.confirmationStatus!=="WAITING"||protection.endsAt.getTime()<=Date.now())return reply.code(409).send({error:"buyer_protection_expired"});
    }
    const id = randomUUID();
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceDispute" ("id","orderId","openedById","reason","summary") VALUES ($1,$2,$3,$4::"DisputeReason",$5)`, id, order.id, user.id, body.data.reason, body.data.summary);
    } catch (error) {
      if (String(error).includes("MarketplaceDispute_active_order_idx")) return reply.code(409).send({ error: "active_dispute_exists" });
      throw error;
    }
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"='DISPUTED',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, order.id);
    await prisma.$executeRawUnsafe(`UPDATE "BuyerProtectionWindow" SET "confirmationStatus"='DISPUTED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, order.id);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','PROCESSING')`, order.id);
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'SYSTEM',$4)`, randomUUID(), id, user.id, `Litige ouvert : ${body.data.reason}`);
    const otherPartyId=String(user.id===order.buyerId?order.sellerId:order.buyerId);
    await notifyOrderParty(otherPartyId,"Nouveau litige sur une commande",`Un litige a été ouvert pour la commande ${order.orderNumber}. Consultez le dossier et répondez si nécessaire.`,String(order.id));
    return reply.code(201).send({ dispute: { id, orderId: order.id, status: "OPEN", reason: body.data.reason } });
  });

  app.get("/disputes/:id", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const parsed = z.object({ id: z.string().min(1) }).safeParse(request.params); if (!parsed.success) return reply.code(400).send({ error: "invalid_dispute" });
    const dispute = await getDispute(parsed.data.id); if (!dispute) return reply.code(404).send({ error: "dispute_not_found" });
    const order = await getOrder(String(dispute.orderId));
    if (!order || (order.buyerId !== user.id && order.sellerId !== user.id && !isDisputeStaff(user))) return reply.code(403).send({ error: "forbidden" });
    const messages = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "DisputeMessage" WHERE "disputeId"=$1 ORDER BY "createdAt" ASC`, dispute.id);
    const evidence = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(`SELECT * FROM "DisputeEvidence" WHERE "disputeId"=$1 ORDER BY "createdAt" ASC`, dispute.id);
    for(const ev of evidence){if(!ev.objectKey){const key=evidenceObjectKeyFromLegacyUrl(ev.fileUrl);if(key){ev.objectKey=key;await prisma.$executeRawUnsafe(`UPDATE "DisputeEvidence" SET "objectKey"=$1 WHERE "id"=$2 AND "objectKey" IS NULL`,key,ev.id).catch(()=>undefined);await makeStoredObjectPrivate(key).catch(()=>undefined)}}}
    return reply.send({ dispute, messages, evidence:evidence.map(evidencePublicShape) });
  });

  app.post("/disputes/:id/messages", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const dispute = await getDispute(params.data.id); if (!dispute) return reply.code(404).send({ error: "dispute_not_found" });
    const order = await getOrder(String(dispute.orderId));
    if (!order || (order.buyerId !== user.id && order.sellerId !== user.id && !isDisputeStaff(user))) return reply.code(403).send({ error: "forbidden" });
    if (["CLOSED","RESOLVED_BUYER","RESOLVED_SELLER"].includes(String(dispute.status))) return reply.code(409).send({ error: "dispute_closed" });
    const id = randomUUID();
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'TEXT',$4)`, id, dispute.id, user.id, body.data.body);
    const recipients=[String(order.buyerId),String(order.sellerId)].filter((partyId,index,all)=>partyId!==String(user.id)&&all.indexOf(partyId)===index);
    await Promise.all(recipients.map(partyId=>notifyOrderParty(partyId,"Nouveau message dans votre litige",`Un nouveau message a été ajouté au dossier de la commande ${order.orderNumber}.`,String(order.id))));
    return reply.code(201).send({ message: { id, body: body.data.body } });
  });

  app.post("/disputes/:id/evidence/upload-direct", { bodyLimit: MAX_EVIDENCE_BYTES }, async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    if(!storageConfigured())return reply.code(503).send({error:"object_storage_not_configured"});
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const dispute=await getDispute(params.data.id);if(!dispute)return reply.code(404).send({error:"dispute_not_found"});
    const order=await getOrder(String(dispute.orderId));if(!order||(order.buyerId!==user.id&&order.sellerId!==user.id))return reply.code(403).send({error:"forbidden"});
    if(["CLOSED","RESOLVED_BUYER","RESOLVED_SELLER"].includes(String(dispute.status)))return reply.code(409).send({error:"dispute_closed"});
    const mimeType=String(request.headers["x-file-mime"]??"").toLowerCase();if(!EVIDENCE_MIME_TYPES.has(mimeType))return reply.code(415).send({error:"unsupported_evidence_type"});
    const data=request.body;if(!Buffer.isBuffer(data)||data.length<1)return reply.code(400).send({error:"empty_evidence"});if(data.length>MAX_EVIDENCE_BYTES)return reply.code(413).send({error:"evidence_too_large",maxBytes:MAX_EVIDENCE_BYTES});
    const count=await prisma.$queryRawUnsafe<Array<{count:bigint}>>(`SELECT COUNT(*)::bigint AS count FROM "DisputeEvidence" WHERE "disputeId"=$1`,dispute.id);if(Number(count[0]?.count??0n)>=12)return reply.code(409).send({error:"evidence_limit_reached",limit:12});
    const rawName=String(request.headers["x-file-name"]??"justificatif");let fileName=rawName.slice(0,180);try{fileName=decodeURIComponent(rawName).slice(0,180)}catch{}
    const evidenceId=randomUUID();const objectKey=`private/disputes/${dispute.id}/${evidenceId}.${evidenceExtension(mimeType)}`;await uploadPrivateStoredObject(objectKey,mimeType,data);
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeEvidence" ("id","disputeId","uploadedById","fileUrl","objectKey","fileName","mimeType","sizeBytes") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,evidenceId,dispute.id,user.id,"private://evidence",objectKey,fileName,mimeType,data.length);
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'EVIDENCE',$4)`,randomUUID(),dispute.id,user.id,`${fileName} ajouté`);
    const otherPartyId=String(user.id===order.buyerId?order.sellerId:order.buyerId);
    await notifyOrderParty(otherPartyId,"Nouveau justificatif dans le litige",`Une nouvelle preuve a été ajoutée au dossier de la commande ${order.orderNumber}.`,String(order.id));
    return reply.code(201).send({evidence:{id:evidenceId,fileName,mimeType,sizeBytes:data.length,downloadUrl:`/api/disputes/${dispute.id}/evidence/${evidenceId}/download`}});
  });

  app.get("/disputes/:id/evidence/:evidenceId/download", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    const params=z.object({id:z.string().min(1),evidenceId:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const dispute=await getDispute(params.data.id);if(!dispute)return reply.code(404).send({error:"dispute_not_found"});
    const order=await getOrder(String(dispute.orderId));if(!order||(order.buyerId!==user.id&&order.sellerId!==user.id&&!isDisputeStaff(user)))return reply.code(403).send({error:"forbidden"});
    const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT * FROM "DisputeEvidence" WHERE "id"=$1 AND "disputeId"=$2 LIMIT 1`,params.data.evidenceId,dispute.id);const ev=rows[0];if(!ev)return reply.code(404).send({error:"evidence_not_found"});
    let objectKey=ev.objectKey as string|null;if(!objectKey){objectKey=evidenceObjectKeyFromLegacyUrl(ev.fileUrl);if(objectKey){await prisma.$executeRawUnsafe(`UPDATE "DisputeEvidence" SET "objectKey"=$1 WHERE "id"=$2`,objectKey,ev.id);await makeStoredObjectPrivate(objectKey).catch(()=>undefined)}}
    if(!objectKey)return reply.code(410).send({error:"legacy_evidence_unavailable"});
    const url=await createPresignedDownload(objectKey,ev.fileName,90);return reply.redirect(url);
  });

  app.post("/disputes/:id/evidence", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;
    return reply.code(410).send({error:"legacy_evidence_url_disabled",use:"upload-direct"});
  });

  app.post("/admin/disputes/:id/status", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!isDisputeStaff(user)) return reply.code(403).send({ error: "admin_required" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ status: z.enum(["UNDER_REVIEW","AWAITING_BUYER","AWAITING_SELLER"]) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const dispute=await getDispute(params.data.id);if(!dispute)return reply.code(404).send({error:"dispute_not_found"});
    const order=await getOrder(String(dispute.orderId));if(!order)return reply.code(404).send({error:"order_not_found"});
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceDispute" SET "status"=$1::"DisputeStatus","updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, body.data.status, params.data.id);
    const statusText=body.data.status==="AWAITING_BUYER"?"Une réponse de l’acheteur est attendue.":body.data.status==="AWAITING_SELLER"?"Une réponse du vendeur est attendue.":"Le dossier est maintenant en cours d’examen.";
    await Promise.all([
      notifyOrderParty(String(order.buyerId),"Mise à jour de votre litige",`${statusText} Commande ${order.orderNumber}.`,String(order.id)),
      notifyOrderParty(String(order.sellerId),"Mise à jour de votre litige",`${statusText} Commande ${order.orderNumber}.`,String(order.id)),
    ]);
    await auditCaseDecision(user.id,"DISPUTE_STATUS_CHANGED","DISPUTE",params.data.id,{status:body.data.status});
    return reply.send({ updated: true });
  });

  app.post("/admin/disputes/:id/resolve", async (request, reply) => {
    const user = await requireUser(request, reply); if (!user) return;
    if (!isDisputeStaff(user)) return reply.code(403).send({ error: "admin_required" });
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    const body = z.object({ outcome: z.enum(["BUYER","SELLER"]), resolution: z.string().trim().min(5).max(2000), refundAmountMinor: z.number().int().positive().optional(), confirmRefund: z.boolean().optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const dispute = await getDispute(params.data.id); if (!dispute) return reply.code(404).send({ error: "dispute_not_found" });
    const order = await getOrder(String(dispute.orderId)); if (!order) return reply.code(404).send({ error: "order_not_found" });
    if (["RESOLVED_BUYER","RESOLVED_SELLER","CLOSED"].includes(String(dispute.status))) return reply.code(409).send({error:"dispute_already_resolved"});
    if(body.data.outcome === "BUYER") {
      if(body.data.confirmRefund!==true)return reply.code(400).send({error:"refund_confirmation_required"});
      let result;
      try{result=await issueMarketplaceRefund({orderId:String(order.id),amountMinor:body.data.refundAmountMinor,reason:`Litige ${dispute.id} · ${body.data.resolution}`,idempotencyKey:`dispute-refund-${dispute.id}`})}
      catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"refund_failed"})}
      const refundStatus=String(result.refund.status);
      if(refundStatus==="FAILED"||refundStatus==="CANCELED")return reply.code(502).send({error:"provider_refund_failed",refundStatus});
      const resolved=refundStatus==="SUCCEEDED";
      await prisma.$executeRawUnsafe(`UPDATE "MarketplaceDispute" SET "status"=$1::"DisputeStatus","resolution"=$2,"refundAmountMinor"=$3,"resolvedAt"=CASE WHEN $1='RESOLVED_BUYER' THEN CURRENT_TIMESTAMP ELSE "resolvedAt" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4`,resolved?"RESOLVED_BUYER":"UNDER_REVIEW",body.data.resolution,result.refund.amountMinor,dispute.id);
      await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='CANCELED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','BLOCKED')`,order.id);
      await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'SYSTEM',$4)`,randomUUID(),dispute.id,user.id,resolved?`Décision acheteur : ${body.data.resolution} · remboursement confirmé`:`Décision acheteur : ${body.data.resolution} · remboursement en cours`);
      await Promise.all([
        notifyOrderParty(String(order.buyerId),resolved?"Litige résolu · remboursement confirmé":"Remboursement en cours",resolved?`Le litige de la commande ${order.orderNumber} a été résolu en votre faveur. Le remboursement a été confirmé.`:`La décision a été prise en votre faveur pour la commande ${order.orderNumber}. Le remboursement est en cours de traitement.`,String(order.id)),
        notifyOrderParty(String(order.sellerId),resolved?"Litige résolu en faveur de l’acheteur":"Décision de litige · remboursement en cours",resolved?`Le litige de la commande ${order.orderNumber} a été résolu en faveur de l’acheteur et le remboursement a été confirmé.`:`Le litige de la commande ${order.orderNumber} a été décidé en faveur de l’acheteur. Le remboursement est en cours.`,String(order.id)),
      ]);
      await auditCaseDecision(user.id,"DISPUTE_RESOLVED_BUYER","DISPUTE",String(dispute.id),{resolution:body.data.resolution,refundAmountMinor:result.refund.amountMinor,refundStatus});
      return reply.code(resolved?200:202).send({resolved,status:resolved?"RESOLVED_BUYER":"UNDER_REVIEW",refund:result.refund});
    }
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceDispute" SET "status"='RESOLVED_SELLER',"resolution"=$1,"refundAmountMinor"=NULL,"resolvedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`, body.data.resolution, dispute.id);
    const shipmentRows=await prisma.$queryRawUnsafe<Array<{status:string;shippedAt:Date|null;deliveredAt:Date|null}>>(`SELECT "status"::text AS "status","shippedAt","deliveredAt" FROM "MarketplaceShipment" WHERE "orderId"=$1 LIMIT 1`,order.id);
    const shipment=shipmentRows[0]??null;
    const shipmentStatus=String(shipment?.status??"");
    const delivered=shipmentStatus==="DELIVERED"&&Boolean(shipment?.deliveredAt);
    const resumedStatus=delivered?"COMPLETED":["IN_TRANSIT","OUT_FOR_DELIVERY","EXCEPTION","RETURNED","LOST"].includes(shipmentStatus)?"SHIPPED":["LABEL_CREATED","CANCELED"].includes(shipmentStatus)?"PROCESSING":"PAID";
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceOrder" SET "status"=$1::"OrderStatus","completedAt"=CASE WHEN $1='COMPLETED' THEN COALESCE("completedAt",CURRENT_TIMESTAMP) ELSE NULL END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,resumedStatus,order.id);
    if(delivered){
      await prisma.$executeRawUnsafe(`UPDATE "Listing" l SET "status"='SOLD',"updatedAt"=CURRENT_TIMESTAMP FROM "MarketplaceOrder" o WHERE o."id"=$1 AND l."id"=o."listingId" AND l."status"='PUBLISHED'`, order.id);
      await prisma.$executeRawUnsafe(`UPDATE "BuyerProtectionWindow" SET "confirmationStatus"=CASE WHEN "confirmationStatus"='DISPUTED' THEN 'AUTO_CONFIRMED'::"DeliveryConfirmationStatus" ELSE "confirmationStatus" END,"confirmedAt"=COALESCE("confirmedAt",CURRENT_TIMESTAMP),"payoutEligibleAt"=COALESCE("payoutEligibleAt",$2::timestamp+INTERVAL '21 days'),"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`,order.id,shipment!.deliveredAt);
    }else{
      await prisma.$executeRawUnsafe(`UPDATE "BuyerProtectionWindow" SET "confirmationStatus"=CASE WHEN "confirmationStatus"='DISPUTED' THEN 'WAITING'::"DeliveryConfirmationStatus" ELSE "confirmationStatus" END,"confirmedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`,order.id);
    }
    await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"=CASE WHEN "status"='BLOCKED' THEN 'PENDING'::"PayoutStatus" ELSE "status" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1`, order.id);
    await prisma.$executeRawUnsafe(`INSERT INTO "DisputeMessage" ("id","disputeId","authorId","kind","body") VALUES ($1,$2,$3,'SYSTEM',$4)`, randomUUID(), dispute.id, user.id, `Décision vendeur : ${body.data.resolution}`);
    await Promise.all([
      notifyOrderParty(String(order.buyerId),"Litige résolu",`Le litige de la commande ${order.orderNumber} a été résolu en faveur du vendeur. Le suivi de la commande reprend selon l’état réel de la livraison.`,String(order.id)),
      notifyOrderParty(String(order.sellerId),"Litige résolu",`Le litige de la commande ${order.orderNumber} a été résolu en votre faveur. Le suivi et le versement reprendront selon l’état réel de la livraison.`,String(order.id)),
    ]);
    await auditCaseDecision(user.id,"DISPUTE_RESOLVED_SELLER","DISPUTE",String(dispute.id),{resolution:body.data.resolution,resumedStatus,shipmentStatus:shipmentStatus||null,delivered});
    return reply.send({ resolved: true, status:"RESOLVED_SELLER", orderStatus:resumedStatus });
  });

  app.post("/admin/returns/:id/approve", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT rr.*,o."buyerId",o."sellerId",o."orderNumber" FROM "MarketplaceReturnRequest" rr JOIN "MarketplaceOrder" o ON o."id"=rr."orderId" WHERE rr."id"=$1 LIMIT 1`,params.data.id);const rr=rows[0];
    if(!rr)return reply.code(404).send({error:"return_request_not_found"});if(String(rr.status)!=="OPEN")return reply.code(409).send({error:"return_request_not_open"});
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceReturnRequest" SET "status"='APPROVED',"approvedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,rr.id);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='BLOCKED',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status" IN ('PENDING','PROCESSING')`,rr.orderId);
    await Promise.all([
      notifyOrderParty(String(rr.buyerId),"Retour autorisé",`Votre demande de retour pour la commande ${rr.orderNumber} est acceptée. Ajoutez le numéro de suivi après l’expédition.`,String(rr.orderId)),
      notifyOrderParty(String(rr.sellerId),"Retour autorisé pour une vente",`Le retour de la commande ${rr.orderNumber} a été autorisé. Le versement reste bloqué jusqu’à la résolution du dossier.`,String(rr.orderId)),
    ]);
    await auditCaseDecision(user.id,"RETURN_APPROVED","RETURN",String(rr.id),{orderId:rr.orderId});
    return reply.send({approved:true,status:"APPROVED"});
  });

  app.post("/admin/returns/:id/resolve", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);
    const body=z.object({outcome:z.enum(["REFUND","REJECT"]),resolution:z.string().trim().min(5).max(2000),refundAmountMinor:z.number().int().positive().optional(),confirmRefund:z.boolean().optional(),overrideReturnReceipt:z.boolean().optional()}).safeParse(request.body);
    if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT rr.*,o."buyerId",o."sellerId",o."orderNumber" FROM "MarketplaceReturnRequest" rr JOIN "MarketplaceOrder" o ON o."id"=rr."orderId" WHERE rr."id"=$1 LIMIT 1`,params.data.id);const rr=rows[0];
    if(!rr)return reply.code(404).send({error:"return_request_not_found"});
    if(["REFUNDED","REJECTED","CLOSED"].includes(String(rr.status)))return reply.code(409).send({error:"return_request_already_resolved"});
    if(body.data.outcome==="REJECT"){
      await prisma.$executeRawUnsafe(`UPDATE "MarketplaceReturnRequest" SET "status"='REJECTED',"resolutionNote"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,rr.id,body.data.resolution);
      const blockers=await prisma.$queryRawUnsafe<Array<{blocked:boolean}>>(`SELECT (EXISTS(SELECT 1 FROM "MarketplaceDispute" d WHERE d."orderId"=$1 AND d."status" NOT IN ('RESOLVED_BUYER','RESOLVED_SELLER','CLOSED')) OR EXISTS(SELECT 1 FROM "MarketplaceRefund" r WHERE r."orderId"=$1 AND r."status" IN ('PENDING','PROCESSING'))) AS blocked`,rr.orderId);
      if(!Boolean(blockers[0]?.blocked))await prisma.$executeRawUnsafe(`UPDATE "MarketplacePayout" SET "status"='PENDING',"updatedAt"=CURRENT_TIMESTAMP WHERE "orderId"=$1 AND "status"='BLOCKED'`,rr.orderId);
      await Promise.all([
        notifyOrderParty(String(rr.buyerId),"Demande de retour refusée",`La demande de retour de la commande ${rr.orderNumber} a été refusée. Consultez le dossier pour connaître la décision.`,String(rr.orderId)),
        notifyOrderParty(String(rr.sellerId),"Dossier de retour mis à jour",`La demande de retour de la commande ${rr.orderNumber} a été refusée.`,String(rr.orderId)),
      ]);
      await auditCaseDecision(user.id,"RETURN_REJECTED","RETURN",String(rr.id),{resolution:body.data.resolution});
      return reply.send({resolved:true,status:"REJECTED"});
    }
    if(body.data.confirmRefund!==true)return reply.code(400).send({error:"refund_confirmation_required"});
    if(!rr.returnShippedAt)return reply.code(409).send({error:"return_not_shipped"});
    if(!rr.sellerReceivedAt&&body.data.overrideReturnReceipt!==true)return reply.code(409).send({error:rr.sellerNotReceivedAt?"seller_reports_return_not_received":"seller_receipt_confirmation_required"});
    let result;try{result=await issueMarketplaceRefund({orderId:String(rr.orderId),amountMinor:body.data.refundAmountMinor,reason:`Retour ${rr.id} · ${body.data.resolution}`,idempotencyKey:`return-refund-${rr.id}`})}catch(error){return reply.code(409).send({error:error instanceof Error?error.message:"refund_failed"})}
    const refundStatus=String(result.refund.status);if(refundStatus==="FAILED"||refundStatus==="CANCELED")return reply.code(502).send({error:"provider_refund_failed",refundStatus});
    const resolved=refundStatus==="SUCCEEDED";await prisma.$executeRawUnsafe(`UPDATE "MarketplaceReturnRequest" SET "status"=$1::"ReturnRequestStatus","resolutionNote"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,resolved?"REFUNDED":"PROCESSING",rr.id,body.data.resolution);
    await Promise.all([
      notifyOrderParty(String(rr.buyerId),resolved?"Retour remboursé":"Remboursement du retour en cours",resolved?`Le remboursement du retour de la commande ${rr.orderNumber} a été confirmé.`:`Le remboursement du retour de la commande ${rr.orderNumber} est en cours de traitement.`,String(rr.orderId)),
      notifyOrderParty(String(rr.sellerId),resolved?"Retour remboursé à l’acheteur":"Remboursement du retour en cours",resolved?`Le retour de la commande ${rr.orderNumber} a été remboursé à l’acheteur.`:`Le remboursement du retour de la commande ${rr.orderNumber} est en cours de traitement.`,String(rr.orderId)),
    ]);
    await auditCaseDecision(user.id,"RETURN_REFUND_DECIDED","RETURN",String(rr.id),{resolution:body.data.resolution,refundAmountMinor:result.refund.amountMinor,refundStatus,overrideReturnReceipt:Boolean(body.data.overrideReturnReceipt)});
    return reply.code(resolved?200:202).send({resolved,status:resolved?"REFUNDED":"PROCESSING",refund:result.refund});
  });

  app.post("/admin/refunds/:id/retry", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const params=z.object({id:z.string().min(1)}).safeParse(request.params);const body=z.object({confirmRetry:z.literal(true)}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"retry_confirmation_required"});
    try{const result=await retryMarketplaceRefund(params.data.id);await auditCaseDecision(user.id,"REFUND_RETRIED","REFUND",params.data.id,{status:result.refund.status});return reply.code(result.refund.status==="SUCCEEDED"?200:202).send(result)}catch(error){const code=error instanceof Error?error.message:"refund_retry_failed";return reply.code(["refund_not_found"].includes(code)?404:409).send({error:code})}
  });

  app.get("/admin/marketplace/cases/:type/:id", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const params=z.object({type:z.enum(["dispute","return","refund"]),id:z.string().min(1)}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:"invalid_case"});
    const type=params.data.type as MarketplaceCaseType;
    let caseRow:any=null;
    if(type==="dispute"){
      const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT d.*,o."orderNumber",o."buyerId",o."sellerId",o."status" AS "orderStatus",o."itemAmountMinor",o."shippingAmountMinor",o."buyerProtectionFeeMinor",o."platformCommissionMinor",o."sellerNetMinor",o."totalAmountMinor",o."currency",o."createdAt" AS "orderCreatedAt",l."id" AS "listingId",l."title",l."slug" FROM "MarketplaceDispute" d JOIN "MarketplaceOrder" o ON o."id"=d."orderId" JOIN "Listing" l ON l."id"=o."listingId" WHERE d."id"=$1 LIMIT 1`,params.data.id);caseRow=rows[0]??null;
    }else if(type==="return"){
      const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT rr.*,o."orderNumber",o."buyerId",o."sellerId",o."status" AS "orderStatus",o."itemAmountMinor",o."shippingAmountMinor",o."buyerProtectionFeeMinor",o."platformCommissionMinor",o."sellerNetMinor",o."totalAmountMinor",o."currency",o."createdAt" AS "orderCreatedAt",l."id" AS "listingId",l."title",l."slug" FROM "MarketplaceReturnRequest" rr JOIN "MarketplaceOrder" o ON o."id"=rr."orderId" JOIN "Listing" l ON l."id"=o."listingId" WHERE rr."id"=$1 LIMIT 1`,params.data.id);caseRow=rows[0]??null;
    }else{
      const rows=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT rf.*,o."orderNumber",o."buyerId",o."sellerId",o."status" AS "orderStatus",o."itemAmountMinor",o."shippingAmountMinor",o."buyerProtectionFeeMinor",o."platformCommissionMinor",o."sellerNetMinor",o."totalAmountMinor",o."currency",o."createdAt" AS "orderCreatedAt",l."id" AS "listingId",l."title",l."slug" FROM "MarketplaceRefund" rf JOIN "MarketplaceOrder" o ON o."id"=rf."orderId" JOIN "Listing" l ON l."id"=o."listingId" WHERE rf."id"=$1 LIMIT 1`,params.data.id);caseRow=rows[0]??null;
    }
    if(!caseRow)return reply.code(404).send({error:"case_not_found"});
    const entityType=caseEntityType(type);
    const [people,payments,refunds,payouts,shipment,protection,auditEvents,riskRows]=await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT u."id",u."email",u."kind"::text AS "kind",COALESCE(p."displayName",p."firstName",u."email") AS "name",p."avatarUrl" FROM "User" u LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE u."id"=ANY($1::text[])`,[String(caseRow.buyerId),String(caseRow.sellerId)]),
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT "id","provider","providerPaymentId","amountMinor","currency","status"::text AS "status","createdAt","updatedAt" FROM "MarketplacePayment" WHERE "orderId"=$1 ORDER BY "createdAt" DESC`,caseRow.orderId),
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT "id","providerRefundId","amountMinor","currency","reason","status"::text AS "status","idempotencyKey","createdAt","updatedAt" FROM "MarketplaceRefund" WHERE "orderId"=$1 ORDER BY "createdAt" DESC`,caseRow.orderId),
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT "id","status"::text AS "status","amountMinor","currency","providerPayoutId","failureReason","retryCount","lastProviderEvent","lastProviderEventAt","availableAt","paidAt","createdAt","updatedAt" FROM "MarketplacePayout" WHERE "orderId"=$1 ORDER BY "createdAt" DESC`,caseRow.orderId),
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT * FROM "MarketplaceShipment" WHERE "orderId"=$1 LIMIT 1`,caseRow.orderId),
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT * FROM "BuyerProtectionWindow" WHERE "orderId"=$1 LIMIT 1`,caseRow.orderId),
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT a."id",a."action",a."entityType",a."entityId",a."metadata",a."createdAt",COALESCE(p."displayName",p."firstName",u."email",'Système') AS "actorName" FROM "AdminAuditEvent" a LEFT JOIN "User" u ON u."id"=a."actorUserId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE (a."entityType"=$1 AND a."entityId"=$2) OR (a."entityType"='REFUND' AND a."entityId" IN (SELECT "id" FROM "MarketplaceRefund" WHERE "orderId"=$3)) ORDER BY a."createdAt" DESC LIMIT 100`,entityType,params.data.id,caseRow.orderId),
      prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT "orderRiskScore","buyerRiskScore","sellerRiskScore","buyerRiskLevel"::text AS "buyerRiskLevel","sellerRiskLevel"::text AS "sellerRiskLevel","signals","paymentGate","paymentResolution","payoutGate","payoutResolution","assessedAt" FROM "MarketplaceOrderRiskReview" WHERE "orderId"=$1 LIMIT 1`,caseRow.orderId),
    ]);
    const personMap=Object.fromEntries(people.map(x=>[x.id,x]));
    let messages:Array<Record<string,any>>=[],evidence:Array<Record<string,any>>=[],linkedDispute:Record<string,any>|null=null,linkedReturn:Record<string,any>|null=null;
    if(type==="dispute")linkedDispute=caseRow;
    else {const linked=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT "id","status"::text AS "status","reason","summary","openedAt","resolvedAt" FROM "MarketplaceDispute" WHERE "orderId"=$1 ORDER BY "openedAt" DESC LIMIT 1`,caseRow.orderId);linkedDispute=linked[0]??null}
    if(type==="return")linkedReturn=caseRow;
    else {const linked=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT "id","status"::text AS "status","reason","details","createdAt","returnTrackingNumber","sellerReceivedAt","sellerNotReceivedAt" FROM "MarketplaceReturnRequest" WHERE "orderId"=$1 ORDER BY "createdAt" DESC LIMIT 1`,caseRow.orderId);linkedReturn=linked[0]??null}
    if(linkedDispute){
      messages=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT m."id",m."authorId",m."kind"::text AS "kind",m."body",m."createdAt",COALESCE(p."displayName",p."firstName",u."email",'Système') AS "authorName" FROM "DisputeMessage" m LEFT JOIN "User" u ON u."id"=m."authorId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE m."disputeId"=$1 ORDER BY m."createdAt" ASC`,linkedDispute.id);
      evidence=await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT "id","fileName","mimeType","sizeBytes","createdAt","uploadedById" FROM "DisputeEvidence" WHERE "disputeId"=$1 ORDER BY "createdAt" ASC`,linkedDispute.id);
      evidence=evidence.map(ev=>({...ev,downloadUrl:`/api/disputes/${linkedDispute!.id}/evidence/${ev.id}/download`}));
    }
    const workspace=await ensureCaseWorkspace(type,params.data.id,String(caseRow.orderId));
    const notes=workspace?await prisma.$queryRawUnsafe<Array<Record<string,any>>>(`SELECT n."id",n."body",n."createdAt",COALESCE(p."displayName",p."firstName",u."email") AS "authorName" FROM "MarketplaceCaseNote" n JOIN "User" u ON u."id"=n."authorUserId" LEFT JOIN "UserProfile" p ON p."userId"=u."id" WHERE n."workspaceId"=$1 ORDER BY n."createdAt" DESC LIMIT 100`,workspace.id):[];
    return reply.send({type,case:caseRow,buyer:personMap[String(caseRow.buyerId)]??null,seller:personMap[String(caseRow.sellerId)]??null,messages,evidence,linkedDispute,linkedReturn,payments,refunds,payout:payouts[0]??null,shipment:shipment[0]??null,protection:protection[0]??null,audit:auditEvents,riskReview:riskRows[0]??null,workspace,notes,viewerId:user.id});
  });

  app.post("/admin/marketplace/cases/:type/:id/claim",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const params=z.object({type:z.enum(["dispute","return","refund"]),id:z.string().min(1)}).safeParse(request.params);const body=z.object({claim:z.boolean()}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const orderId=await caseOrderId(params.data.type,params.data.id);if(!orderId)return reply.code(404).send({error:"case_not_found"});const w=await ensureCaseWorkspace(params.data.type,params.data.id,orderId);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceCaseWorkspace" SET "assignedToUserId"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,body.data.claim?user.id:null,w.id);
    await auditCaseDecision(user.id,body.data.claim?"CASE_CLAIMED":"CASE_RELEASED",caseEntityType(params.data.type),params.data.id,{orderId});return reply.send({updated:true});
  });

  app.post("/admin/marketplace/cases/:type/:id/priority",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const params=z.object({type:z.enum(["dispute","return","refund"]),id:z.string().min(1)}).safeParse(request.params);const body=z.object({priority:z.enum(["NORMAL","HIGH","URGENT"])}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const orderId=await caseOrderId(params.data.type,params.data.id);if(!orderId)return reply.code(404).send({error:"case_not_found"});const w=await ensureCaseWorkspace(params.data.type,params.data.id,orderId);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceCaseWorkspace" SET "priority"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,body.data.priority,w.id);
    await auditCaseDecision(user.id,"CASE_PRIORITY_CHANGED",caseEntityType(params.data.type),params.data.id,{orderId,priority:body.data.priority});return reply.send({updated:true,priority:body.data.priority});
  });

  app.post("/admin/marketplace/cases/:type/:id/notes",async(request,reply)=>{
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const params=z.object({type:z.enum(["dispute","return","refund"]),id:z.string().min(1)}).safeParse(request.params);const body=z.object({body:z.string().trim().min(2).max(5000)}).safeParse(request.body);if(!params.success||!body.success)return reply.code(400).send({error:"invalid_request"});
    const orderId=await caseOrderId(params.data.type,params.data.id);if(!orderId)return reply.code(404).send({error:"case_not_found"});const w=await ensureCaseWorkspace(params.data.type,params.data.id,orderId);
    await prisma.$executeRawUnsafe(`INSERT INTO "MarketplaceCaseNote" ("id","workspaceId","authorUserId","body") VALUES ($1,$2,$3,$4)`,randomUUID(),w.id,user.id,body.data.body);
    await prisma.$executeRawUnsafe(`UPDATE "MarketplaceCaseWorkspace" SET "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,w.id);
    await auditCaseDecision(user.id,"CASE_INTERNAL_NOTE_ADDED",caseEntityType(params.data.type),params.data.id,{orderId});return reply.code(201).send({saved:true});
  });

  app.get("/admin/marketplace/cases", async (request, reply) => {
    const user=await requireUser(request,reply);if(!user)return;if(!isDisputeStaff(user))return reply.code(403).send({error:"admin_required"});
    const disputes=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT d.*,o."orderNumber",o."totalAmountMinor",o."currency",l."title",(SELECT COUNT(*)::int FROM "DisputeEvidence" e WHERE e."disputeId"=d."id") AS "evidenceCount" FROM "MarketplaceDispute" d JOIN "MarketplaceOrder" o ON o."id"=d."orderId" JOIN "Listing" l ON l."id"=o."listingId" ORDER BY d."openedAt" DESC LIMIT 100`);
    const returns=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT rr.*,o."orderNumber",o."totalAmountMinor",o."currency",l."title" FROM "MarketplaceReturnRequest" rr JOIN "MarketplaceOrder" o ON o."id"=rr."orderId" JOIN "Listing" l ON l."id"=o."listingId" ORDER BY rr."createdAt" DESC LIMIT 100`);
    const failedRefunds=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT r."id",r."orderId",r."amountMinor",r."currency",r."reason",r."createdAt",o."orderNumber",l."title" FROM "MarketplaceRefund" r JOIN "MarketplaceOrder" o ON o."id"=r."orderId" JOIN "Listing" l ON l."id"=o."listingId" WHERE r."status"='FAILED' AND NOT EXISTS(SELECT 1 FROM "MarketplaceRefund" r2 WHERE r2."orderId"=r."orderId" AND r2."idempotencyKey" LIKE (CASE WHEN position(':retry:' in r."idempotencyKey")>0 THEN split_part(r."idempotencyKey",':retry:',1) ELSE r."idempotencyKey" END)||':retry:%' AND r2."status" IN ('PROCESSING','SUCCEEDED')) ORDER BY r."createdAt" DESC LIMIT 50`);
    return reply.send({disputes,returns,failedRefunds});
  });

}
