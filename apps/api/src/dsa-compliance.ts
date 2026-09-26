import { randomUUID } from "node:crypto";
import { prisma } from "@pa/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendApplicationEmail } from "./email-provider.js";
import { requireAdminRoles } from "./rbac.js";

const noticeSchema=z.object({
  reporterName:z.string().trim().max(200).optional(),
  reporterEmail:z.string().email().optional(),
  identityException:z.boolean().optional().default(false),
  targetType:z.enum(["LISTING","USER","MESSAGE","STORE","OTHER"]),
  targetId:z.string().min(1).max(120),
  contentUrl:z.string().url().optional(),
  legalBasis:z.string().trim().max(1000).optional(),
  explanation:z.string().trim().min(20).max(5000),
  goodFaithDeclaration:z.literal(true),
}).superRefine((value,ctx)=>{
  if(value.identityException)return;
  if(!value.reporterName?.trim())ctx.addIssue({code:"custom",path:["reporterName"],message:"reporter_name_required"});
  if(!value.reporterEmail?.trim())ctx.addIssue({code:"custom",path:["reporterEmail"],message:"reporter_email_required"});
});

export async function registerDsaComplianceRoutes(app: FastifyInstance) {
  app.post("/dsa/notices", async (request, reply) => {
    const parsed=noticeSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"invalid_notice",details:parsed.error.flatten()});
    const id=randomUUID();
    const reference=`DSA-${Date.now().toString(36).toUpperCase()}-${id.slice(0,6).toUpperCase()}`;
    const d=parsed.data;
    await prisma.$executeRawUnsafe(`INSERT INTO "DsaIllegalContentNotice" ("id","reference","reporterName","reporterEmail","targetType","targetId","contentUrl","legalBasis","explanation","goodFaithDeclaration") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)`,id,reference,d.reporterName?.trim()||null,d.reporterEmail?.trim()||null,d.targetType,d.targetId,d.contentUrl??null,d.legalBasis??null,d.explanation);
    const trackingUrl=`https://petitannonces.fr/signaler-contenu-illicite?reference=${encodeURIComponent(reference)}`;
    if(d.reporterEmail){void sendApplicationEmail({to:d.reporterEmail,replyTo:"info@petitannonces.fr",subject:`Signalement DSA reçu · ${reference}`,text:`Votre signalement de contenu potentiellement illicite a été reçu. Référence : ${reference}. Vous pouvez suivre son statut sur ${trackingUrl}`,html:`<p>Votre signalement de contenu potentiellement illicite a été reçu.</p><p><strong>Référence : ${reference}</strong></p><p><a href="${trackingUrl}">Suivre le signalement</a></p>`,idempotencyKey:`dsa-receipt-${id}`}).catch(error=>request.log.warn({error,reference},"dsa receipt email failed"));}
    void sendApplicationEmail({to:"info@petitannonces.fr",subject:`Nouveau signalement DSA · ${reference}`,text:`Un signalement DSA a été reçu. Type : ${d.targetType}. Cible : ${d.targetId}. Référence : ${reference}.`,html:`<p><strong>Nouveau signalement DSA</strong></p><p>Référence : ${reference}<br/>Type : ${d.targetType}<br/>Cible : ${d.targetId}</p>`,idempotencyKey:`dsa-admin-${id}`}).catch(error=>request.log.warn({error,reference},"dsa admin email failed"));
    return reply.code(201).send({notice:{id,reference,status:"RECEIVED"}});
  });

  app.get("/admin/dsa/notices",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MODERATOR","COMPLIANCE"])},async(request,reply)=>{
    const q=z.object({status:z.enum(["RECEIVED","UNDER_REVIEW","ACTIONED","NO_ACTION","CLOSED"]).optional(),limit:z.coerce.number().int().min(1).max(200).default(100)}).safeParse(request.query);
    if(!q.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "id","reference","reporterName","reporterEmail","targetType","targetId","contentUrl","legalBasis","explanation","status","decision","decisionReason","receivedAt","decidedAt" FROM "DsaIllegalContentNotice" WHERE ($1::text IS NULL OR "status"::text=$1) ORDER BY "receivedAt" DESC LIMIT $2`,q.data.status??null,q.data.limit);
    return reply.send({notices:rows});
  });

  app.patch("/admin/dsa/notices/:id",{preHandler:requireAdminRoles(["SUPER_ADMIN","ADMIN","MODERATOR","COMPLIANCE"])},async(request,reply)=>{
    const p=z.object({id:z.string().min(1)}).safeParse(request.params);
    const b=z.object({status:z.enum(["UNDER_REVIEW","ACTIONED","NO_ACTION","CLOSED"]),decision:z.string().trim().min(3).max(1000).optional(),decisionReason:z.string().trim().min(3).max(3000).optional()}).safeParse(request.body);
    if(!p.success||!b.success)return reply.code(400).send({error:"invalid_request"});
    const rows=await prisma.$queryRawUnsafe<Array<{id:string;reference:string;reporterEmail:string|null}>>(`UPDATE "DsaIllegalContentNotice" SET "status"=$2::"DsaNoticeStatus","decision"=$3,"decisionReason"=$4,"decidedAt"=CASE WHEN $2 IN ('ACTIONED','NO_ACTION','CLOSED') THEN CURRENT_TIMESTAMP ELSE "decidedAt" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 RETURNING "id","reference","reporterEmail"`,p.data.id,b.data.status,b.data.decision??null,b.data.decisionReason??null);
    const notice=rows[0];if(!notice)return reply.code(404).send({error:"notice_not_found"});
    if(notice.reporterEmail&&["ACTIONED","NO_ACTION","CLOSED"].includes(b.data.status)){
      const reason=b.data.decisionReason??b.data.decision??"La décision est disponible avec votre référence.";
      void sendApplicationEmail({to:notice.reporterEmail,replyTo:"info@petitannonces.fr",subject:`Décision DSA · ${notice.reference}`,text:`Votre signalement ${notice.reference} a été traité. Statut : ${b.data.status}. ${reason}`,html:`<p>Votre signalement <strong>${notice.reference}</strong> a été traité.</p><p>Statut : <strong>${b.data.status}</strong></p><p>${reason.replace(/[<&>]/g,"")}</p>`,idempotencyKey:`dsa-decision-${notice.id}-${b.data.status}`}).catch(error=>request.log.warn({error,reference:notice.reference},"dsa decision email failed"));
    }
    return reply.send({updated:true,notice:{id:notice.id,reference:notice.reference,status:b.data.status}});
  });

  app.get("/dsa/notices/:reference", async (request, reply) => {
    const parsed=z.object({reference:z.string().min(5).max(100)}).safeParse(request.params);
    if(!parsed.success)return reply.code(400).send({error:"invalid_reference"});
    const rows=await prisma.$queryRawUnsafe<Array<Record<string,unknown>>>(`SELECT "reference","status","decision","decisionReason","receivedAt","decidedAt" FROM "DsaIllegalContentNotice" WHERE "reference"=$1 LIMIT 1`,parsed.data.reference);
    if(!rows[0])return reply.code(404).send({error:"notice_not_found"});
    return reply.send({notice:rows[0]});
  });
}
